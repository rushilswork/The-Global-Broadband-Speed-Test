# SpeedPulse - Internet Speed Test

**Live demo: https://speedpulse.onrender.com** (free tier: the first visit after idle takes up to ~50 s to wake up)

![CI](https://github.com/rushilswork/The-Global-Broadband-Speed-Test/actions/workflows/ci.yml/badge.svg)

**Stack:** Node · Express 5 · libSQL/Turso · bcrypt · vanilla JS (no build step). Hosted free on Render with a Turso database.

A browser-based speed test with accounts and history. Measures **your** connection (not the server's): download, upload, latency, jitter and a **bufferbloat grade** (latency under load).

## Features
- Parallel-stream download/upload test with a live gauge and throughput graph; TCP ramp-up is excluded from the result
- Idle latency + jitter, and loaded latency during transfers, graded A+ to F
- Test against **Cloudflare's** public speed endpoints (internet) or **this server** (LAN/self-hosted)
- Works signed out (results kept in the browser). Sign up to keep history across devices; local results are migrated on sign-in
- History page: summary stats, download/upload chart, delete, CSV export
- Download a shareable result image
- No frameworks, no build step

## Run
Requires Node 20+. Data is stored with libSQL: a local SQLite file in development, [Turso](https://turso.tech) (free) in production.

```bash
npm install
npm start
```
Open http://localhost:3000. See `.env.example`; set these in your environment for production:

| Variable | Purpose |
|---|---|
| `PORT` | Port (default 3000) |
| `SESSION_SECRET` | **Required in production.** Signs session cookies |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Production database (Turso). Without them a local file is used, which hosts with ephemeral disks (Render free) wipe on restart |
| `DB_PATH` | Local SQLite file when Turso isn't configured (default `./data/speedpulse.db`) |
| `NODE_ENV=production` | Secure cookies, proxy trust |

```bash
npm test
```

## Security notes
- Passwords hashed with bcrypt; sign-in responses and timing do not reveal whether an email exists
- Signed, `httpOnly`, `SameSite=Lax` session cookies; JSON-only writes (no cross-site form posts)
- Helmet with a strict Content-Security-Policy (`script-src 'self'`; only `speed.cloudflare.com` allowed for cross-origin requests)
- Rate limits on auth and test endpoints; validated, size-limited inputs; per-user data access
- No secrets in the repo

## Notes on accuracy
Browser tests are bounded by the device, Wi-Fi, VPNs and the test server's route. Cloudflare only exposes your IP to browsers, so location/ISP are not shown for that server. Upload progress is measured from bytes the browser has handed to the network, so very short tests can over-read slightly; the ramp-up skip reduces this.

## Layout
| Path | Purpose |
|---|---|
| `server.js` | Entry point |
| `src/app.js` | Express app: auth, results API, local test endpoints |
| `src/db.js`, `src/validate.js` | libSQL connection + schema, input validation |
| `public/js/engine.js` | The speed test engine |
| `public/js/*.js`, `public/*.html` | UI |
| `test/` | `node:test` API + engine tests |

## Persistent storage with Turso (free)
```bash
turso auth login
turso db create speedpulse
turso db show speedpulse --url          # -> TURSO_DATABASE_URL
turso db tokens create speedpulse       # -> TURSO_AUTH_TOKEN
```
Or create the database in the Turso dashboard. On Render, set both variables under Environment. The schema is created automatically on first start.

## Deploy
### Render + Turso (free)
`render.yaml` is a Render Blueprint. Create the Turso database (above), then in Render choose New → Blueprint, pick this repo and fill in `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when prompted. `SESSION_SECRET` is generated for you.

### Docker
```bash
docker build -t speedpulse .
docker run -p 3000:3000 -e NODE_ENV=production -e SESSION_SECRET=$(openssl rand -hex 32) -v speedpulse-data:/app/data speedpulse
```

> The previous version stored plaintext passwords and a database credential in the source (now removed). If you ever used it, that credential should be considered exposed and rotated.
