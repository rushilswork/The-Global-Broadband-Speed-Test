import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
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
  `)
  return db
}
