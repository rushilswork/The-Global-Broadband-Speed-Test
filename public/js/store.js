// Result storage: server (when signed in) or localStorage (guests). Also keeps the nav link in sync.
const KEY = 'sp.results'

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status })
  return data
}
export { api }

let userPromise
export function currentUser() {
  userPromise ??= api('/me').then((d) => d.user).catch(() => null)
  return userPromise
}
export function resetUser() { userPromise = undefined }

export async function syncNav() {
  const user = await currentUser()
  const link = document.getElementById('nav-account')
  if (link && !link.classList.contains('active')) link.textContent = user ? 'Account' : 'Sign in'
  return user
}

const readLocal = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? [] } catch { return [] }
}
const writeLocal = (rows) => {
  try { localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 500))) } catch { /* storage full or blocked: results just aren't kept */ }
}

/** Saves a result. Returns where it was stored: 'account' or 'browser'. */
export async function saveResult(result) {
  if (await currentUser()) {
    try {
      await api('/results', { method: 'POST', body: result })
      return 'account'
    } catch (err) {
      if (err.status !== 401) throw err
      resetUser()
    }
  }
  writeLocal([{ ...result, id: `l${Date.now()}` }, ...readLocal()])
  return 'browser'
}

export async function loadResults() {
  if (await currentUser()) return { results: (await api('/results')).results, source: 'account' }
  return { results: readLocal(), source: 'browser' }
}

export async function deleteResult(id, source) {
  if (source === 'account') return api(`/results/${id}`, { method: 'DELETE' })
  writeLocal(readLocal().filter((r) => r.id !== id))
}

export async function clearResults(source) {
  if (source === 'account') return api('/results', { method: 'DELETE' })
  writeLocal([])
}

/** After signing in, move any guest results into the account. */
export async function migrateLocal() {
  const rows = readLocal()
  if (!rows.length) return 0
  const payload = rows.map(({ id, ...r }) => r)
  for (let i = 0; i < payload.length; i += 100) await api('/results', { method: 'POST', body: payload.slice(i, i + 100) })
  writeLocal([])
  return rows.length
}

export const fmtNum = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : v >= 100 ? Math.round(v).toString() : v.toFixed(d))
