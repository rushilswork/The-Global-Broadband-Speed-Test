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

const { app } = createApp({ dbPath: process.env.DB_PATH || './data/speedpulse.db', secret, production })
const port = Number(process.env.PORT) || 3000
app.listen(port, () => console.log(`SpeedPulse running at http://localhost:${port}`))
