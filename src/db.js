import { createClient } from '@libsql/client'
import fs from 'node:fs'
import path from 'node:path'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    download REAL NOT NULL, upload REAL NOT NULL,
    latency REAL, jitter REAL, loaded_down REAL, loaded_up REAL, bufferbloat REAL,
    grade TEXT, server TEXT, ip TEXT, city TEXT, country TEXT, isp TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_results_user_at ON results(user_id, at DESC);
`

/**
 * Opens a libSQL database. `url` is either a remote Turso URL (libsql://...) with an `authToken`,
 * or a local SQLite file (file:./data/app.db) / ':memory:' for development and tests.
 */
export async function openDb({ url = ':memory:', authToken } = {}) {
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(path.resolve(url.slice('file:'.length))), { recursive: true })
  const db = createClient({ url, authToken })
  await db.execute('PRAGMA foreign_keys = ON')
  await db.executeMultiple(SCHEMA)
  return db
}
