const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)
const str = (v, max = 100) => (typeof v === 'string' ? v.slice(0, max) : null)

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/

/** Returns a clean result row or null if the payload isn't a plausible speed test. */
export function cleanResult(body) {
  if (!body || typeof body !== 'object') return null
  const download = num(body.download, 0, 100000)
  const upload = num(body.upload, 0, 100000)
  if (download == null || upload == null) return null
  const at = typeof body.at === 'string' && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : new Date().toISOString()
  return {
    at,
    download,
    upload,
    latency: num(body.latency, 0, 60000),
    jitter: num(body.jitter, 0, 60000),
    loaded_down: num(body.loadedDown, 0, 60000),
    loaded_up: num(body.loadedUp, 0, 60000),
    bufferbloat: num(body.bufferbloat, 0, 60000),
    grade: str(body.grade, 3),
    server: str(body.server),
    ip: str(body.ip, 64),
    city: str(body.city),
    country: str(body.country, 8),
    isp: str(body.isp),
  }
}

export function rowToResult(r) {
  return {
    id: r.id,
    at: r.at,
    download: r.download,
    upload: r.upload,
    latency: r.latency,
    jitter: r.jitter,
    loadedDown: r.loaded_down,
    loadedUp: r.loaded_up,
    bufferbloat: r.bufferbloat,
    grade: r.grade,
    server: r.server,
    ip: r.ip,
    city: r.city,
    country: r.country,
    isp: r.isp,
  }
}
