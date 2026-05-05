'use strict';

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { exec }      = require('child_process');
const { promisify } = require('util');
const Groq          = require('groq-sdk');

const execAsync = promisify(exec);

const { GROQ_ADMIN_KEY, ADMIN_USERS, GROQ_MODELS } = require('./config');
const { pool, sessions }                            = require('./utils/session');

const PROJECT_ROOT = path.join(__dirname, '..');
const ADMIN_MODEL  = GROQ_MODELS.qwen;
const groqAdmin    = GROQ_ADMIN_KEY ? new Groq({ apiKey: GROQ_ADMIN_KEY }) : null;

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
async function getPM2Logs(lines = 60) {
  // Strategy 1: pm2 CLI
  try {
    const { stdout, stderr } = await execAsync(
      `pm2 logs --nostream --lines ${lines} 2>&1`,
      { timeout: 8000 }
    );
    const out = (stdout + '\n' + stderr).trim();
    if (out.length > 20) return { source: 'pm2', logs: out.slice(-6000) };
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

      if (content.trim().length > 20) return { source: 'pm2-files', logs: content.slice(-6000) };
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

// ─── Source Code Reader ────────────────────────────────────────────────────────
// 6 file kunci × 2000 chars ≈ 3000 token — cukup untuk audit bermakna
const ADMIN_FILES = [
  'src/router.js',
  'src/handlers.js',
  'src/prompts.js',
  'src/menus.js',
  'src/admin.js',
  'index.js',
];
const CHARS_PER_FILE = 2000;

function readProjectFiles(names = ADMIN_FILES) {
  return names.map(name => {
    try {
      const content = fs.readFileSync(path.join(PROJECT_ROOT, name), 'utf8');
      const snippet = content.slice(0, CHARS_PER_FILE);
      const note    = content.length > CHARS_PER_FILE ? ` [+${content.length - CHARS_PER_FILE}ch]` : '';
      return `=== ${name}${note} ===\n${snippet}`;
    } catch {
      return `=== ${name} === [tidak ditemukan]`;
    }
  }).join('\n\n');
}

// ─── System Prompt ─────────────────────────────────────────────────────────────
const AUDIT_SYSTEM_PROMPT = `Kamu adalah DevOps assistant untuk bot Telegram Node.js. Jawab ringkas dalam format HTML Telegram.

Struktur output (max 10 baris total):
<b>Sistem</b>
🔴/🟡/🟢 temuan singkat

<b>Keamanan</b>
🔴/🟡/🟢 temuan singkat

<b>Bug Kode</b>
🔴/🟡/🟢 temuan singkat

Aturan:
- 🔴 Kritis | 🟡 Perhatian | 🟢 Aman
- 1 baris per temuan, padat
- Seksi aman → cukup tulis 🟢 Aman
- Tag: <b> <i> <code> saja — NO markdown, NO intro/outro`;

// ─── AI: Full Audit (code only) ────────────────────────────────────────────────
async function analyzeCode(question, files = ADMIN_FILES) {
  if (!groqAdmin) throw new Error('GROQ Admin tidak tersedia');

  const completion = await groqAdmin.chat.completions.create({
    model:    ADMIN_MODEL,
    messages: [
      { role: 'system', content: AUDIT_SYSTEM_PROMPT },
      { role: 'user',   content: `Source code:\n\n${readProjectFiles(files)}\n\n---\n${question}` },
    ],
    temperature: 0.2,
    max_tokens:  1024,
  });

  const raw = completion.choices[0]?.message?.content || 'Tidak ada response.';
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ─── AI: Deep Diagnosis (code + logs) ─────────────────────────────────────────
async function analyzeWithContext(question) {
  if (!groqAdmin) throw new Error('GROQ Admin tidak tersedia');

  const [pmResult, dbHealth] = await Promise.all([getPM2Logs(50), getDBHealth()]);

  const dbLine = dbHealth.status === 'OK'
    ? `DB OK | ${dbHealth.latencyMs}ms | sessions: ${dbHealth.activeSessions}/${dbHealth.totalSessions}`
    : `DB ERROR: ${dbHealth.error}`;

  const userContent = [
    `[LOGS — ${pmResult.source}]\n${pmResult.logs.slice(-1500)}`,
    `[DB] ${dbLine}`,
    `[CODE]\n${readProjectFiles()}`,
    `[TUGAS] ${question}`,
  ].join('\n\n');

  const completion = await groqAdmin.chat.completions.create({
    model:    ADMIN_MODEL,
    messages: [
      { role: 'system', content: AUDIT_SYSTEM_PROMPT },
      { role: 'user',   content: userContent },
    ],
    temperature: 0.2,
    max_tokens:  1024,
  });

  const raw = completion.choices[0]?.message?.content || 'Tidak ada response.';
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

module.exports = {
  groqAdmin,
  ADMIN_MODEL,
  ADMIN_FILES,
  isAdmin,
  readProjectFiles,
  analyzeCode,
  analyzeWithContext,
  getSystemHealth,
  getPM2Logs,
  getDBHealth,
};
