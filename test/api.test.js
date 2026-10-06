import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'

let server, base

before(async () => {
  const { app } = await createApp({ db: { url: ':memory:' }, secret: 'test-secret' })
  await new Promise((r) => { server = app.listen(0, r) })
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

// minimal cookie-jar client
function client() {
  let cookie = ''
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers }
  }
}

const good = { download: 120.5, upload: 40.2, latency: 12, jitter: 2, loadedDown: 30, loadedUp: 25, bufferbloat: 18, grade: 'A', server: 'Cloudflare', ip: '1.2.3.4', city: 'Chennai', country: 'IN', isp: 'AS1' }

test('signup validates input', async () => {
  const c = client()
  assert.equal((await c('/api/auth/signup', { method: 'POST', body: { email: 'nope', password: 'longenough' } })).status, 400)
  assert.equal((await c('/api/auth/signup', { method: 'POST', body: { email: 'a@b.co', password: 'short' } })).status, 400)
  assert.equal((await c('/api/auth/signup', { method: 'POST', body: { email: 'a@b.co' } })).status, 400)
})

test('signup, session, duplicate, signin, signout', async () => {
  const c = client()
  const up = await c('/api/auth/signup', { method: 'POST', body: { email: 'Rushil@Example.com', password: 'correct horse' } })
  assert.equal(up.status, 201)
  assert.equal((await c('/api/me')).json.user.email, 'rushil@example.com')

  const dup = await client()('/api/auth/signup', { method: 'POST', body: { email: 'rushil@example.com', password: 'another one' } })
  assert.equal(dup.status, 409)

  await c('/api/auth/signout', { method: 'POST', body: {} })
  assert.equal((await c('/api/me')).json.user, null)

  const bad = await c('/api/auth/signin', { method: 'POST', body: { email: 'rushil@example.com', password: 'wrong password' } })
  assert.equal(bad.status, 401)
  const unknown = await c('/api/auth/signin', { method: 'POST', body: { email: 'nobody@example.com', password: 'wrong password' } })
  assert.equal(unknown.status, 401)
  assert.equal(unknown.json.error, bad.json.error) // no user enumeration

  const ok = await c('/api/auth/signin', { method: 'POST', body: { email: 'RUSHIL@example.com', password: 'correct horse' } })
  assert.equal(ok.status, 200)
})

test('results require auth and are scoped per user', async () => {
  assert.equal((await client()('/api/results')).status, 401)
  assert.equal((await client()('/api/results', { method: 'POST', body: good })).status, 401)

  const a = client()
  const b = client()
  await a('/api/auth/signup', { method: 'POST', body: { email: 'a1@example.com', password: 'password-a1' } })
  await b('/api/auth/signup', { method: 'POST', body: { email: 'b1@example.com', password: 'password-b1' } })

  assert.equal((await a('/api/results', { method: 'POST', body: good })).status, 201)
  assert.equal((await a('/api/results', { method: 'POST', body: [good, { ...good, download: 5 }] })).json.saved, 2)

  const list = (await a('/api/results')).json.results
  assert.equal(list.length, 3)
  assert.equal(list[0].city, 'Chennai')
  assert.equal((await b('/api/results')).json.results.length, 0)

  // user B cannot delete user A's row
  assert.equal((await b(`/api/results/${list[0].id}`, { method: 'DELETE' })).status, 404)
  assert.equal((await a(`/api/results/${list[0].id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await a('/api/results')).json.results.length, 2)
  assert.equal((await a('/api/results', { method: 'DELETE' })).status, 204)
  assert.equal((await a('/api/results')).json.results.length, 0)
})

test('account deletion requires the password and removes all data', async () => {
  const a = client()
  await a('/api/auth/signup', { method: 'POST', body: { email: 'del@example.com', password: 'delete-me-123' } })
  await a('/api/results', { method: 'POST', body: good })

  assert.equal((await client()('/api/auth/delete-account', { method: 'POST', body: { password: 'x' } })).status, 401) // not signed in
  assert.equal((await a('/api/auth/delete-account', { method: 'POST', body: { password: 'wrong-password' } })).status, 401)
  assert.equal((await a('/api/results')).json.results.length, 1) // still there

  assert.equal((await a('/api/auth/delete-account', { method: 'POST', body: { password: 'delete-me-123' } })).status, 204)
  assert.equal((await a('/api/me')).json.user, null)
  const again = await client()('/api/auth/signin', { method: 'POST', body: { email: 'del@example.com', password: 'delete-me-123' } })
  assert.equal(again.status, 401)
})

test('rejects implausible results', async () => {
  const a = client()
  await a('/api/auth/signup', { method: 'POST', body: { email: 'v@example.com', password: 'password-v1' } })
  for (const body of [{}, { download: 'fast', upload: 1 }, { download: -1, upload: 1 }, { download: 1e9, upload: 1 }, [good, {}]]) {
    assert.equal((await a('/api/results', { method: 'POST', body })).status, 400, JSON.stringify(body))
  }
})

test('non-JSON writes and malformed JSON are rejected', async () => {
  const form = await fetch(`${base}/api/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' })
  assert.equal(form.status, 415)
  const bad = await fetch(`${base}/api/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' })
  assert.equal(bad.status, 400)
})

test('session cookie is httpOnly + SameSite=Lax', async () => {
  const res = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'c@example.com', password: 'password-c1' }) })
  const cookie = res.headers.getSetCookie().join(';').toLowerCase()
  assert.match(cookie, /httponly/)
  assert.match(cookie, /samesite=lax/)
})

test('local speed endpoints: ping, download size, upload', async () => {
  assert.equal((await fetch(`${base}/api/ping`)).status, 204)
  const down = await fetch(`${base}/api/down?bytes=300000`)
  assert.equal((await down.arrayBuffer()).byteLength, 300000)
  const capped = await fetch(`${base}/api/down?bytes=-5`)
  assert.equal((await capped.arrayBuffer()).byteLength, 0)
  const up = await fetch(`${base}/api/up`, { method: 'POST', body: new Uint8Array(200000) })
  assert.equal(up.status, 204)
})

test('security headers present', async () => {
  const res = await fetch(`${base}/api/ping`)
  assert.ok(res.headers.get('content-security-policy').includes("default-src 'self'"))
  assert.equal(res.headers.get('x-powered-by'), null)
})
