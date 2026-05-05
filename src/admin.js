'use strict';

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { exec }      = require('child_process');
const { promisify } = require('util');
const Groq          = require('groq-sdk');

const execAsync = promisify(exec);

const { GROQ_ADMIN_KEYS, ADMIN_USERS, GROQ_MODELS } = require('./config');
const { pool, sessions }                             = require('./utils/session');

const PROJECT_ROOT = path.join(__dirname, '..');
const ADMIN_MODEL  = GROQ_MODELS.qwen;

// ─── Multi-key Groq Pool ───────────────────────────────────────────────────────
// Gabungkan semua key unik (GROQ_ADMIN_API_KEY + GROQ_API_KEY) → 2× kapasitas TPM
const groqPool  = GROQ_ADMIN_KEYS.map(key => new Groq({ apiKey: key }));
let   poolIndex = 0;

function getNextClient() {
  if (groqPool.length === 0) throw new Error('Tidak ada GROQ_API_KEY yang tersedia');
  const client = groqPool[poolIndex];
  poolIndex    = (poolIndex + 1) % groqPool.length;
  return client;
}

// Panggil API dengan round-robin key + fallback ke key berikut jika rate limit
async function groqCreate(params) {
  let lastErr;
  for (let attempt = 0; attempt < groqPool.length; attempt++) {
    const client = groqPool[(poolIndex + attempt) % groqPool.length];
    try {
      const res = await client.chat.completions.create(params);
      poolIndex  = (poolIndex + attempt + 1) % groqPool.length; // advance ke key berikutnya
      return res;
    } catch (err) {
      lastErr = err;
      const isRateLimit = err.status === 429 || err.message?.includes('rate_limit');
      if (!isRateLimit || groqPool.length === 1) throw err;
      console.warn(`[Admin Pool] Key #${(poolIndex + attempt) % groqPool.length} rate limited, coba key berikutnya...`);
    }
  }
  throw lastErr;
}

// Untuk export legacy (digunakan handlers.js untuk cek ketersediaan)
const groqAdmin = groqPool.length > 0 ? groqPool[0] : null;

// ─── Guard ─────────────────────────────────────────────────────────────────────
function isAdmin(userId) {
  return ADMIN_USERS.length > 0 && ADMIN_USERS.includes(userId);
}

// ─── System Health ─────────────────────────────────────────────────────────────
function getSystemHealth() {
  const mem      = process.memoryUsage();
  const totalRam = os.totalmem();
  const freeRam  = os.freemem();
  const usedRam  = totalRam - freeRam;
  const loadAvg  = os.loadavg();
  const cpuCount = os.cpus().length;
  const uptime   = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = Math.floor(uptime % 60);
  const isProd   = process.env.NODE_ENV === 'production';
  const ramPct   = Math.round((usedRam / totalRam) * 100);

  return {
    uptimeFormatted:  `${h}j ${m}m ${s}d`,
    heapUsedMB:       Math.round(mem.heapUsed  / 1024 / 1024),
    heapTotalMB:      Math.round(mem.heapTotal / 1024 / 1024),
    rssMB:            Math.round(mem.rss        / 1024 / 1024),
    systemRamUsedMB:  Math.round(usedRam  / 1024 / 1024),
    systemRamTotalMB: Math.round(totalRam / 1024 / 1024),
    ramUsedPct:       ramPct,
    loadAvg1m:        loadAvg[0].toFixed(2),
    loadAvg5m:        loadAvg[1].toFixed(2),
    loadAvg15m:       loadAvg[2].toFixed(2),
    cpuCount,
    nodeVersion:      process.version,
    env:              isProd ? 'production' : 'development',
    ...(isProd && {
      hostname:    os.hostname(),
      osUptime:    Math.floor(os.uptime() / 3600) + 'j',
      loadWarning: parseFloat(loadAvg[0].toFixed(2)) > cpuCount ? '⚠️ tinggi' : 'OK',
      ramWarning:  ramPct > 85 ? '⚠️ hampir penuh' : 'OK',
    }),
  };
}

// ─── PM2 / Runtime Log Reader ──────────────────────────────────────────────────
async function getPM2Logs(lines = 80) {
  // Strategy 1: pm2 CLI
  try {
    const { stdout, stderr } = await execAsync(
      `pm2 logs --nostream --lines ${lines} 2>&1`,
      { timeout: 8000 }
    );
    const out = (stdout + '\n' + stderr).trim();
    if (out.length > 20) return { source: 'pm2', logs: out };
  } catch {}

  // Strategy 2: pm2 log files
  try {
    const pm2LogDir = path.join(os.homedir(), '.pm2', 'logs');
    if (fs.existsSync(pm2LogDir)) {
      const files = fs.readdirSync(pm2LogDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({ f, mtime: fs.statSync(path.join(pm2LogDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 3)
        .map(({ f }) => f);

      const content = files.map(f => {
        const full = fs.readFileSync(path.join(pm2LogDir, f), 'utf8');
        return `[${f}]\n${full.split('\n').slice(-Math.ceil(lines / files.length)).join('\n')}`;
      }).join('\n\n');

      if (content.trim().length > 20) return { source: 'pm2-files', logs: content };
    }
  } catch {}

  return { source: 'unavailable', logs: 'PM2 tidak tersedia. Log ada di console.' };
}

// ─── NeonDB Health ─────────────────────────────────────────────────────────────
async function getDBHealth() {
  const start = Date.now();
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN data->>'history' != '[]' THEN 1 ELSE 0 END) AS active FROM sessions"
    );
    return {
      status:         'OK',
      latencyMs:      Date.now() - start,
      totalSessions:  parseInt(rows[0].total  ?? 0),
      activeSessions: parseInt(rows[0].active ?? 0),
      inMemory:       sessions.size,
    };
  } catch (err) {
    return { status: 'ERROR', error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── AI: Log Diagnosa ──────────────────────────────────────────────────────────
// Hanya baca log runtime + DB health — data nyata, bukan kode
const LOG_PROMPT = `Kamu menganalisa runtime log dari bot Telegram Node.js.
Tugasmu: identifikasi error nyata, exception, crash, atau anomali dari teks log.

Aturan ketat:
- Hanya laporkan yang ADA di log — jangan asumsi atau tambah temuan dari imajinasi
- Kalau log bersih: tulis saja "🟢 Log bersih, tidak ada error."
- Format ringkas: max 10 baris, 1 temuan per baris
- Tag HTML: <b> <i> <code> saja — NO markdown, NO intro/outro basa-basi`;

async function analyzeWithContext(question) {
  if (groqPool.length === 0) throw new Error('Tidak ada GROQ API key yang tersedia');

  const [pmResult, dbHealth] = await Promise.all([getPM2Logs(80), getDBHealth()]);

  const dbLine = dbHealth.status === 'OK'
    ? `OK | ${dbHealth.latencyMs}ms | sessions aktif: ${dbHealth.activeSessions}/${dbHealth.totalSessions}`
    : `ERROR: ${dbHealth.error}`;

  const userContent = [
    `[RUNTIME LOGS — sumber: ${pmResult.source}]\n${pmResult.logs}`,
    `[DB STATUS] ${dbLine}`,
    `[TUGAS] ${question}`,
  ].join('\n\n');

  const completion = await groqCreate({
    model:    ADMIN_MODEL,
    messages: [
      { role: 'system', content: LOG_PROMPT },
      { role: 'user',   content: userContent },
    ],
    temperature: 0.1,
    max_tokens:  1024,
  });

  const raw = completion.choices[0]?.message?.content || 'Tidak ada response.';
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

module.exports = {
  groqAdmin,
  groqPool,
  ADMIN_MODEL,
  isAdmin,
  analyzeWithContext,
  getSystemHealth,
  getPM2Logs,
  getDBHealth,
};
