import crypto from 'node:crypto'
import { createApp } from './src/app.js'

const production = process.env.NODE_ENV === 'production'
let secret = process.env.SESSION_SECRET
if (!secret) {
  if (production) {
    console.error('SESSION_SECRET is required in production.')
    process.exit(1)
  }
  secret = crypto.randomBytes(32).toString('hex')
  console.warn('SESSION_SECRET not set: using a random one (sessions reset on restart).')
}

// Turso (libSQL) when configured; otherwise a local SQLite file. A local file does NOT survive redeploys on
// hosts with ephemeral disks (e.g. Render free tier), so production should set TURSO_DATABASE_URL.
const url = process.env.TURSO_DATABASE_URL || `file:${process.env.DB_PATH || './data/speedpulse.db'}`
if (production && url.startsWith('file:')) console.warn('Using a local database file; data will be lost on hosts with ephemeral disks. Set TURSO_DATABASE_URL.')
const { app } = await createApp({ db: { url, authToken: process.env.TURSO_AUTH_TOKEN }, secret, production })
const port = Number(process.env.PORT) || 3000
app.listen(port, () => console.log(`SpeedPulse running at http://localhost:${port}`))
