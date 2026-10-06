import { SERVERS, runSpeedTest } from './engine.js'
import { saveResult, syncNav, fmtNum } from './store.js'

const $ = (id) => document.getElementById(id)
const ARC = Math.PI * 90 // length of the gauge arc
const SCALE_MAX = 1000
let controller = null
let last = null

/* ---------- gauge ---------- */
const frac = (mbps) => Math.min(Math.log10(1 + Math.max(mbps, 0)) / Math.log10(1 + SCALE_MAX), 1)

function buildTicks() {
  const NS = 'http://www.w3.org/2000/svg'
  for (const v of [0, 5, 10, 50, 100, 250, 500, 1000]) {
    const a = Math.PI * (1 - frac(v))
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('x', (110 + 104 * Math.cos(a)).toFixed(1))
    t.setAttribute('y', (110 - 104 * Math.sin(a) + 3).toFixed(1))
    t.setAttribute('text-anchor', 'middle')
    t.textContent = v
    $('g-ticks').append(t)
  }
}

function setGauge(mbps) {
  const f = frac(mbps)
  $('g-fill').setAttribute('stroke-dasharray', `${(f * ARC).toFixed(1)} ${ARC.toFixed(1)}`)
  $('big').textContent = fmtNum(mbps)
}

/* ---------- live sparkline ---------- */
let spark = []
function pushSpark(v) {
  spark.push(v)
  const max = Math.max(...spark, 1)
  const pts = spark.map((s, i) => `${((i / Math.max(spark.length - 1, 1)) * 300).toFixed(1)},${(48 - (s / max) * 44).toFixed(1)}`)
  $('spark-line').setAttribute('points', pts.join(' '))
}

/* ---------- UI state ---------- */
const PHASES = { latency: 'Measuring latency', download: 'Testing download', upload: 'Testing upload', done: 'Complete' }

function setRunning(running) {
  const go = $('go')
  go.textContent = running ? 'STOP' : last ? 'AGAIN' : 'GO'
  go.classList.toggle('stop', running)
  $('server').disabled = running
  document.body.classList.toggle('running', running)
}

function showError(msg) {
  $('error').hidden = !msg
  $('error').textContent = msg || ''
}

function resetResults() {
  for (const id of ['r-down', 'r-up', 'r-lat', 'r-jit']) $(id).textContent = '-'
  $('r-grade').textContent = '-'
  $('r-grade').dataset.grade = ''
  $('r-loaded').textContent = ''
  $('saved').textContent = ''
  $('share').disabled = true
  spark = []
  $('spark-line').setAttribute('points', '')
  setGauge(0)
}

function bloatText(r) {
  if (r.bufferbloat == null) return ''
  const msg = r.bufferbloat < 30 ? 'Your connection stays responsive under load.' : r.bufferbloat < 200 ? 'Noticeable lag when the line is busy.' : 'Heavy lag when the line is busy; calls and games will suffer.'
  return `+${Math.round(r.bufferbloat)} ms when busy. ${msg}`
}

function showFinal(r) {
  $('r-down').textContent = fmtNum(r.download)
  $('r-up').textContent = fmtNum(r.upload)
  $('r-lat').textContent = fmtNum(r.latency, 0)
  $('r-jit').textContent = fmtNum(r.jitter)
  $('r-grade').textContent = r.grade ?? '-'
  $('r-grade').dataset.grade = (r.grade ?? '').replace('+', 'plus')
  $('r-loaded').textContent = bloatText(r)
  setGauge(r.download)
  $('big-unit').textContent = 'Mbps'
}

function showConnection(meta) {
  const bits = [meta.ip, [meta.city, meta.country].filter(Boolean).join(', '), meta.isp].filter(Boolean)
  $('conn').textContent = bits.length ? bits.join('  ·  ') : ''
}

/* ---------- run ---------- */
async function start() {
  showError('')
  resetResults()
  controller = new AbortController()
  setRunning(true)
  let phase = 'latency'
  try {
    const result = await runSpeedTest({
      serverKey: $('server').value,
      signal: controller.signal,
      onPhase: (p) => {
        phase = p
        $('phase').textContent = PHASES[p] ?? ''
        if (p === 'download' || p === 'upload') { spark = []; $('big-unit').textContent = 'Mbps' }
      },
      onProgress: (p) => {
        if (p.phase === 'latency') {
          $('r-lat').textContent = fmtNum(p.latency, 0)
          $('r-jit').textContent = fmtNum(p.jitter)
          return
        }
        setGauge(p.mbps)
        pushSpark(p.mbps)
        $(p.phase === 'download' ? 'r-down' : 'r-up').textContent = fmtNum(p.mbps)
      },
    })
    last = result
    showFinal(result)
    $('phase').textContent = PHASES.done
    showConnection(result)
    $('share').disabled = false
    try {
      const where = await saveResult(result)
      $('saved').textContent = where === 'account' ? 'Saved to your account.' : 'Saved in this browser.'
    } catch {
      $('saved').textContent = 'Could not save this result.'
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      $('phase').textContent = 'Stopped'
    } else {
      $('phase').textContent = 'Failed'
      showError(phase === 'latency' ? err.message : `The ${phase} test failed: ${err.message}`)
    }
  } finally {
    controller = null
    setRunning(false)
  }
}

/* ---------- share image ---------- */
function downloadImage() {
  if (!last) return
  const c = document.createElement('canvas')
  c.width = 1200
  c.height = 630
  const g = c.getContext('2d')
  const bg = g.createLinearGradient(0, 0, 1200, 630)
  bg.addColorStop(0, '#0c1220')
  bg.addColorStop(1, '#14233f')
  g.fillStyle = bg
  g.fillRect(0, 0, 1200, 630)
  g.fillStyle = '#14e0c4'
  g.font = '700 40px system-ui, sans-serif'
  g.fillText('SpeedPulse', 60, 90)
  g.fillStyle = '#9fb0c4'
  g.font = '28px system-ui, sans-serif'
  g.fillText(new Date(last.at).toLocaleString(), 60, 135)
  const cell = (label, value, unit, x, y, color) => {
    g.fillStyle = '#9fb0c4'
    g.font = '30px system-ui, sans-serif'
    g.fillText(label, x, y)
    g.fillStyle = color
    g.font = '700 96px system-ui, sans-serif'
    g.fillText(value, x, y + 100)
    const w = g.measureText(value).width
    g.fillStyle = '#9fb0c4'
    g.font = '30px system-ui, sans-serif'
    g.fillText(unit, x + w + 12, y + 100)
  }
  cell('DOWNLOAD', fmtNum(last.download), 'Mbps', 60, 230, '#ffffff')
  cell('UPLOAD', fmtNum(last.upload), 'Mbps', 640, 230, '#ffffff')
  cell('LATENCY', fmtNum(last.latency, 0), 'ms', 60, 420, '#ffffff')
  cell('JITTER', fmtNum(last.jitter), 'ms', 400, 420, '#ffffff')
  cell('BUFFERBLOAT', last.grade ?? '-', '', 740, 420, '#14e0c4')
  g.fillStyle = '#6c7b91'
  g.font = '24px system-ui, sans-serif'
  g.fillText([last.city, last.country].filter(Boolean).join(', ') + (last.server ? `  ·  ${last.server}` : ''), 60, 590)
  c.toBlob((blob) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'speedpulse-result.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })
}

/* ---------- boot ---------- */
buildTicks()
setGauge(0)
for (const [key, s] of Object.entries(SERVERS)) $('server').append(new Option(s.name, key))
$('go').addEventListener('click', () => (controller ? controller.abort() : start()))
$('share').addEventListener('click', downloadImage)
syncNav()
