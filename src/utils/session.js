'use strict';

const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});

// ─── In-memory cache (source of truth for reads) ───────────────────────────────
const sessions = new Map();

// ─── Schema + startup load ─────────────────────────────────────────────────────
async function initSessions() {
  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id    TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Load all sessions into memory
  const { rows } = await pool.query('SELECT chat_id, data FROM sessions');
  for (const row of rows) {
    sessions.set(row.chat_id, row.data);
  }

  // One-time migration: sessions.json → NeonDB
  if (sessions.size === 0) {
    const jsonFile = path.join(__dirname, '..', '..', 'sessions.json');
    try {
      if (fs.existsSync(jsonFile)) {
        const raw     = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const entries = Object.entries(raw);
        if (entries.length > 0) {
          console.log(`📦 Migrating ${entries.length} sessions: JSON → NeonDB...`);
          for (const [chatId, session] of entries) sessions.set(chatId, session);
          await _persistAll();
          fs.unlinkSync(jsonFile);
          console.log('✅ Migration selesai, sessions.json dihapus');
        }
      }
    } catch (e) {
      console.warn('⚠️ Migration JSON gagal (lanjut saja):', e.message);
    }
  }

  console.log(`📂 Session siap: ${sessions.size} loaded dari NeonDB`);
}

// ─── Internal: upsert satu session ────────────────────────────────────────────
async function _persistOne(chatId) {
  const data = sessions.get(String(chatId));
  if (!data) return;
  await pool.query(
    `INSERT INTO sessions (chat_id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (chat_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [String(chatId), JSON.stringify(data)]
  );
}

// ─── Internal: upsert semua session ───────────────────────────────────────────
async function _persistAll() {
  const entries = [...sessions.entries()];
  if (entries.length === 0) return;
  await Promise.all(
    entries.map(([chatId, data]) =>
      pool.query(
        `INSERT INTO sessions (chat_id, data, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (chat_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [String(chatId), JSON.stringify(data)]
      )
    )
  );
}

// ─── Public API ────────────────────────────────────────────────────────────────

// Sync read — always from in-memory cache
function getSession(chatId) {
  const key = String(chatId);
  if (!sessions.has(key)) {
    sessions.set(key, { history: [], mode: 'general', model: 'auto', adminMode: false });
  }
  return sessions.get(key);
}

// Fire-and-forget: save ONE session (after every AI response)
function saveSession(chatId) {
  _persistOne(chatId).catch(e => console.warn('⚠️ DB save gagal:', e.message));
}

// Fire-and-forget: save ALL sessions (bulk ops, SIGINT, SIGTERM)
function saveSessions() {
  _persistAll().catch(e => console.warn('⚠️ DB bulk save gagal:', e.message));
}

module.exports = { pool, sessions, initSessions, getSession, saveSession, saveSessions };
