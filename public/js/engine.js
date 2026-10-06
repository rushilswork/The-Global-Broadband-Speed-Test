// Browser speed-test engine: latency/jitter, parallel-stream download and upload, loaded latency (bufferbloat).
// Measures the *visitor's* connection because all traffic flows browser <-> test server.

export const SERVERS = {
  cloudflare: {
    name: 'Cloudflare (internet)',
    down: (bytes) => `https://speed.cloudflare.com/__down?bytes=${bytes}`,
    up: 'https://speed.cloudflare.com/__up',
    ping: 'https://speed.cloudflare.com/__down?bytes=0',
    maxBytes: 8_000_000, // Cloudflare rejects requests of 10 MB or more
  },
  local: {
    name: 'This server (local network)',
    down: (bytes) => `/api/down?bytes=${bytes}`,
    up: '/api/up',
    ping: '/api/ping',
    maxBytes: 50 * 1024 * 1024,
  },
}

const MB = 1024 * 1024
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })

export const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
// Mean absolute difference between consecutive samples (RFC 3550-style jitter).
export const jitterOf = (a) => (a.length < 2 ? 0 : a.slice(1).reduce((sum, v, i) => sum + Math.abs(v - a[i]), 0) / (a.length - 1))

export function gradeBufferbloat(ms) {
  if (ms == null) return null
  if (ms < 5) return 'A+'
  if (ms < 30) return 'A'
  if (ms < 60) return 'B'
  if (ms < 200) return 'C'
  if (ms < 400) return 'D'
  return 'F'
}

// getRandomValues is capped at 64 KiB per call; random data also defeats any compression on the path.
function randomBytes(n) {
  const buf = new Uint8Array(n)
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(buf.subarray(i, Math.min(i + 65536, n)))
  return buf
}

export const mbps =(bytes, ms) => (ms > 0 ? (bytes * 8) / 1e6 / (ms / 1000) : 0)

async function pingOnce(server, signal) {
  const t0 = performance.now()
  const res = await fetch(`${server.ping}${server.ping.includes('?') ? '&' : '?'}r=${Math.random().toString(36).slice(2)}`, { cache: 'no-store', signal })
  await res.arrayBuffer()
  return { ms: performance.now() - t0, headers: res.headers }
}

/** Reads the visitor's IP / city / ASN from the Cloudflare edge's response headers. */
export function metaFromHeaders(h) {
  const get = (k) => h.get(k) || null
  if (!get('cf-meta-ip')) return {}
  return { ip: get('cf-meta-ip'), city: get('cf-meta-city'), country: get('cf-meta-country'), colo: get('cf-meta-colo'), isp: get('cf-meta-asn') ? `AS${get('cf-meta-asn')}` : null }
}

export async function measureLatency(server, { count = 15, signal } = {}) {
  const first = await pingOnce(server, signal) // warms DNS/TLS; its timing is discarded
  const samples = []
  for (let i = 0; i < count; i++) {
    samples.push((await pingOnce(server, signal)).ms)
    await sleep(40, signal)
  }
  return { latency: median(samples), min: Math.min(...samples), jitter: jitterOf(samples), samples, meta: metaFromHeaders(first.headers) }
}

/** Pings continuously in the background while a transfer saturates the link. */
function startLoadedPinger(server, signal) {
  const samples = []
  let stop = false
  const done = (async () => {
    while (!stop && !signal?.aborted) {
      try {
        samples.push((await pingOnce(server, signal)).ms)
      } catch { /* an aborted/failed ping is simply skipped */ }
      await sleep(150).catch(() => {})
    }
  })()
  return async () => { stop = true; await done; return samples }
}

/**
 * Runs `worker` in `streams` parallel loops for `durationMs`, sampling total bytes every 100ms.
 * The reported speed ignores the TCP slow-start ramp (first `rampMs`), then averages the rest.
 */
async function runTransfer({ streams, durationMs, rampMs, worker, onProgress, signal }) {
  const ctl = new AbortController()
  signal?.addEventListener('abort', () => ctl.abort(), { once: true })
  let total = 0
  const addBytes = (n) => { total += n }
  const t0 = performance.now()
  let rampBytes = null
  let rampAt = null
  const points = []
  const tick = setInterval(() => {
    const now = performance.now() - t0
    if (rampBytes == null && now >= rampMs) { rampBytes = total; rampAt = now }
    points.push([now, total])
    const recent = points.filter(([t]) => t >= now - 1000)
    const [ta, ba] = recent[0]
    onProgress?.({ mbps: mbps(total - ba, now - ta), progress: Math.min(now / durationMs, 1) })
  }, 100)
  const workers = Array.from({ length: streams }, () => worker(ctl.signal, addBytes).catch(() => {}))
  try {
    await sleep(durationMs, signal)
  } finally {
    clearInterval(tick)
    ctl.abort()
    await Promise.allSettled(workers)
  }
  const elapsed = performance.now() - t0
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const useRamp = rampBytes != null && elapsed - rampAt > 1000
  const speed = useRamp ? mbps(total - rampBytes, elapsed - rampAt) : mbps(total, elapsed)
  return { mbps: speed, bytes: total, points }
}

async function downloadWorker(server, signal, addBytes) {
  let size = Math.min(2 * MB, server.maxBytes)
  let failures = 0
  while (!signal.aborted) {
    try {
      const url = server.down(size)
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}r=${Math.random().toString(36).slice(2)}`, { cache: 'no-store', signal })
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        addBytes(value.byteLength)
      }
      failures = 0
      size = Math.min(size * 2, server.maxBytes) // fast links finish early, so ask for more next time
    } catch (err) {
      if (signal.aborted) return
      // Back off to smaller requests and retry rather than silently losing a stream.
      if (++failures > 5) throw err
      size = Math.max(Math.floor(size / 2), MB)
      await sleep(200, signal)
    }
  }
}

function uploadWorker(server, payload, signal, addBytes) {
  return new Promise((resolve) => {
    const loop = () => {
      if (signal.aborted) return resolve()
      const xhr = new XMLHttpRequest()
      let last = 0
      xhr.open('POST', server.up)
      xhr.upload.onprogress = (e) => { addBytes(e.loaded - last); last = e.loaded }
      xhr.onload = loop
      xhr.onerror = () => resolve()
      signal.addEventListener('abort', () => { xhr.abort(); resolve() }, { once: true })
      xhr.send(payload)
    }
    loop()
  })
}

/**
 * Full test. `onPhase(name)` and `onProgress({phase, mbps, progress, latency})` drive the UI.
 * Throws an AbortError if cancelled, or a normal Error when the server can't be reached.
 */
export async function runSpeedTest({ serverKey = 'cloudflare', signal, onPhase, onProgress, durationMs = 8000 } = {}) {
  const server = SERVERS[serverKey]
  if (!server) throw new Error('Unknown test server')

  onPhase?.('latency')
  let lat
  try {
    lat = await measureLatency(server, { signal })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Couldn't reach the test server (${server.name}). Check your connection or try another server.`)
  }
  onProgress?.({ phase: 'latency', latency: lat.latency, jitter: lat.jitter, progress: 1 })

  onPhase?.('download')
  const stopDownPing = startLoadedPinger(server, signal)
  let down
  try {
    down = await runTransfer({
      streams: 6, durationMs, rampMs: 1500, signal,
      worker: (s, add) => downloadWorker(server, s, add),
      onProgress: (p) => onProgress?.({ phase: 'download', ...p }),
    })
  } finally {
    var loadedDown = await stopDownPing()
  }
  if (down.bytes === 0) throw new Error('Download test transferred no data.')

  onPhase?.('upload')
  const payload = new Blob([randomBytes(4 * MB)])
  const stopUpPing = startLoadedPinger(server, signal)
  let up
  try {
    up = await runTransfer({
      streams: 4, durationMs, rampMs: 1500, signal,
      worker: (s, add) => uploadWorker(server, payload, s, add),
      onProgress: (p) => onProgress?.({ phase: 'upload', ...p }),
    })
  } finally {
    var loadedUp = await stopUpPing()
  }

  const ld = median(loadedDown)
  const lu = median(loadedUp)
  const worst = Math.max(ld ?? 0, lu ?? 0)
  const bufferbloat = ld == null && lu == null ? null : Math.max(0, worst - lat.latency)
  onPhase?.('done')
  return {
    at: new Date().toISOString(),
    download: down.mbps,
    upload: up.mbps,
    latency: lat.latency,
    jitter: lat.jitter,
    loadedDown: ld,
    loadedUp: lu,
    bufferbloat,
    grade: gradeBufferbloat(bufferbloat),
    server: server.name,
    ...lat.meta,
  }
}
