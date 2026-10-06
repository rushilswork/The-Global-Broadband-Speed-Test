import { loadResults, deleteResult, clearResults, syncNav, fmtNum } from './store.js'

const $ = (id) => document.getElementById(id)
let state = { results: [], source: 'browser' }

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v)
  }
  n.append(...kids)
  return n
}

function summary(rows) {
  const box = $('summary')
  box.replaceChildren()
  if (!rows.length) return
  const avg = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length
  const items = [
    ['Tests', String(rows.length), ''],
    ['Avg download', fmtNum(avg('download')), 'Mbps'],
    ['Avg upload', fmtNum(avg('upload')), 'Mbps'],
    ['Best download', fmtNum(Math.max(...rows.map((r) => r.download))), 'Mbps'],
    ['Avg latency', fmtNum(rows.filter((r) => r.latency != null).reduce((s, r, _, a) => s + r.latency / a.length, 0), 0), 'ms'],
  ]
  for (const [label, value, unit] of items) box.append(el('article', { class: 'stat' }, el('h2', {}, label), el('p', {}, el('b', {}, value), ' ', el('small', {}, unit))))
}

function chart(rows) {
  const svg = $('chart')
  svg.replaceChildren()
  $('chart-panel').hidden = rows.length < 2
  if (rows.length < 2) return
  const NS = 'http://www.w3.org/2000/svg'
  const data = [...rows].reverse() // oldest first
  const W = 700, H = 220, L = 44, R = 10, T = 10, B = 24
  const max = Math.max(...data.flatMap((r) => [r.download, r.upload]), 1) * 1.1
  const x = (i) => L + (i / (data.length - 1)) * (W - L - R)
  const y = (v) => T + (1 - v / max) * (H - T - B)
  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    return n
  }
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    svg.append(mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }))
    const t = mk('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' })
    t.textContent = Math.round(v)
    svg.append(t)
  }
  for (const [key, cls] of [['download', 'down'], ['upload', 'up']]) {
    svg.append(mk('polyline', { points: data.map((r, i) => `${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' '), class: `line ${cls}` }))
    data.forEach((r, i) => {
      const dot = mk('circle', { cx: x(i).toFixed(1), cy: y(r[key]).toFixed(1), r: 3.5, class: `dot ${cls}` })
      const title = mk('title', {})
      title.textContent = `${new Date(r.at).toLocaleString()}: ${fmtNum(r[key])} Mbps ${key}`
      dot.append(title)
      svg.append(dot)
    })
  }
}

function table(rows) {
  const body = document.querySelector('#table tbody')
  body.replaceChildren()
  $('empty').hidden = rows.length > 0
  $('table').parentElement.hidden = rows.length === 0
  for (const r of rows) {
    body.append(
      el('tr', {},
        el('td', {}, new Date(r.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
        el('td', {}, `${fmtNum(r.download)} Mbps`),
        el('td', {}, `${fmtNum(r.upload)} Mbps`),
        el('td', {}, r.latency == null ? '-' : `${Math.round(r.latency)} ms`),
        el('td', {}, r.jitter == null ? '-' : `${fmtNum(r.jitter)} ms`),
        el('td', {}, r.grade ?? '-'),
        el('td', {}, [r.city, r.country].filter(Boolean).join(', ') || r.ip || '-'),
        el('td', {}, el('button', { type: 'button', class: 'icon', 'aria-label': 'Delete this result', onclick: async () => {
          await deleteResult(r.id, state.source)
          refresh()
        } }, '✕'))),
    )
  }
}

async function refresh() {
  state = await loadResults()
  $('banner').hidden = state.source === 'account'
  summary(state.results)
  chart(state.results)
  table(state.results)
  $('export').disabled = $('clear').disabled = !state.results.length
}

function exportCsv() {
  const cols = ['at', 'download', 'upload', 'latency', 'jitter', 'loadedDown', 'loadedUp', 'bufferbloat', 'grade', 'server', 'ip', 'city', 'country', 'isp']
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csv = [cols.join(','), ...state.results.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'speedpulse-history.csv' })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

$('export').addEventListener('click', exportCsv)
$('clear').addEventListener('click', async () => {
  if (!confirm('Delete all saved results? This cannot be undone.')) return
  await clearResults(state.source)
  refresh()
})
syncNav()
refresh().catch(() => { $('empty').hidden = false; $('empty').textContent = 'Could not load your results.' })
