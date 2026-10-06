import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieSession from 'cookie-session'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { cleanResult, rowToResult, EMAIL_RE } from './validate.js'

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const MAX_BYTES = 100 * 1024 * 1024
const COLS = ['at', 'download', 'upload', 'latency', 'jitter', 'loaded_down', 'loaded_up', 'bufferbloat', 'grade', 'server', 'ip', 'city', 'country', 'isp']

export function createApp({ dbPath = ':memory:', secret, production = false } = {}) {
  if (!secret) throw new Error('A session secret is required')
  const db = openDb(dbPath)
  const app = express()
  app.disable('x-powered-by')
  if (production) app.set('trust proxy', 1)

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'https://speed.cloudflare.com'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
    }),
  )

  /* ---- speed test endpoints (used by the "This server" option) ---- */
  const noStore = (res) => res.set('Cache-Control', 'no-store, no-transform')
  const testLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false })

  app.get('/api/ping', testLimiter, (req, res) => {
    noStore(res)
    res.status(204).end()
  })

  app.get('/api/down', testLimiter, (req, res) => {
    const bytes = Math.min(Math.max(parseInt(req.query.bytes, 10) || 0, 0), MAX_BYTES)
    noStore(res)
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes) })
    const chunk = crypto.randomBytes(64 * 1024)
    let sent = 0
    let closed = false
    res.on('close', () => { closed = true })
    const pump = () => {
      while (!closed && sent < bytes) {
        const n = Math.min(chunk.length, bytes - sent)
        sent += n
        if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) {
          res.once('drain', pump)
          return
        }
      }
      if (!closed) res.end()
    }
    pump()
  })

  app.post('/api/up', testLimiter, (req, res) => {
    let received = 0
    req.on('data', (c) => {
      received += c.length
      if (received > MAX_BYTES) req.destroy()
    })
    req.on('end', () => {
      noStore(res)
      res.status(204).end()
    })
    req.on('error', () => {})
  })

  /* ---- JSON API ---- */
  const api = express.Router()
  api.use(express.json({ limit: '100kb', type: 'application/json' }))
  // Cookies are SameSite=Lax and every write needs a JSON content type, which a cross-site <form> cannot send.
  api.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Expected application/json' })
    }
    next()
  })
  api.use(
    cookieSession({
      name: 'sp_session',
      keys: [secret],
      maxAge: 14 * 24 * 3600 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: production,
    }),
  )
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  })
  const requireUser = (req, res, next) => (req.session?.uid ? next() : res.status(401).json({ error: 'Sign in required' }))

  const findByEmail = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
  const insertUser = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
  const getUser = db.prepare('SELECT id, email FROM users WHERE id = ?')
  // Comparing against a dummy hash keeps unknown-email and wrong-password timing equal.
  const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10)

  api.post('/auth/signup', authLimiter, async (req, res) => {
    const { email, password } = req.body ?? {}
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'Enter a valid email address.' })
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must be 8-72 characters.' })
    }
    const clean = email.trim().toLowerCase()
    if (findByEmail.get(clean)) return res.status(409).json({ error: 'An account with that email already exists.' })
    const hash = await bcrypt.hash(password, 10)
    try {
      const { lastInsertRowid } = insertUser.run(clean, hash)
      req.session = { uid: Number(lastInsertRowid) }
      res.status(201).json({ user: { email: clean } })
    } catch {
      res.status(409).json({ error: 'An account with that email already exists.' })
    }
  })

  api.post('/auth/signin', authLimiter, async (req, res) => {
    const { email, password } = req.body ?? {}
    const valid = typeof email === 'string' && typeof password === 'string'
    const user = valid ? findByEmail.get(email.trim().toLowerCase()) : null
    const ok = await bcrypt.compare(valid ? password : '', user?.password_hash ?? DUMMY_HASH)
    if (!user || !ok) return res.status(401).json({ error: 'Incorrect email or password.' })
    req.session = { uid: user.id }
    res.json({ user: { email: user.email } })
  })

  api.post('/auth/signout', (req, res) => {
    req.session = null
    res.status(204).end()
  })

  api.get('/me', (req, res) => {
    const user = req.session?.uid ? getUser.get(req.session.uid) : null
    res.json({ user: user ? { email: user.email } : null })
  })

  const listResults = db.prepare(`SELECT id, ${COLS.join(', ')} FROM results WHERE user_id = ? ORDER BY at DESC LIMIT 500`)
  const insertResult = db.prepare(`INSERT INTO results (user_id, ${COLS.join(', ')}) VALUES (?, ${COLS.map(() => '?').join(', ')})`)
  const deleteResult = db.prepare('DELETE FROM results WHERE id = ? AND user_id = ?')
  const clearResults = db.prepare('DELETE FROM results WHERE user_id = ?')

  api.get('/results', requireUser, (req, res) => {
    res.json({ results: listResults.all(req.session.uid).map(rowToResult) })
  })

  api.post('/results', requireUser, (req, res) => {
    const items = Array.isArray(req.body) ? req.body.slice(0, 100) : [req.body]
    const rows = items.map(cleanResult)
    if (!rows.length || rows.some((r) => !r)) return res.status(400).json({ error: 'Invalid result payload.' })
    db.exec('BEGIN')
    try {
      for (const r of rows) insertResult.run(req.session.uid, ...COLS.map((c) => r[c]))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    res.status(201).json({ saved: rows.length })
  })

  api.delete('/results/:id', requireUser, (req, res) => {
    const { changes } = deleteResult.run(Number(req.params.id), req.session.uid)
    res.status(changes ? 204 : 404).end()
  })

  api.delete('/results', requireUser, (req, res) => {
    clearResults.run(req.session.uid)
    res.status(204).end()
  })

  api.use((req, res) => res.status(404).json({ error: 'Not found' }))
  app.use('/api', api)

  app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: production ? '1h' : 0 }))

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' })
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' })
    console.error(err)
    res.status(500).json({ error: 'Something went wrong' })
  })

  return { app, db }
}
