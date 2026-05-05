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

// ─── Rolling error buffer (max 50 entries) ─────────────────────────────────────
const errorLog = [];
function pushError(label, message) {
  errorLog.push({ ts: new Date().toISOString(), label, message });
  if (errorLog.length > 50) errorLog.shift();
}

// Patch global console.error to capture errors into rolling buffer
const _origError = console.error.bind(console);
console.error = (...args) => {
  pushError('console.error', args.map(String).join(' '));
  _origError(...args);
};

function isAdmin(userId) {
  return ADMIN_USERS.length > 0 && ADMIN_USERS.includes(userId);
}

// ─── System Health ─────────────────────────────────────────────────────────────
function getSystemHealth() {
  const mem       = process.memoryUsage();
  const totalRam  = os.totalmem();
  const freeRam   = os.freemem();
  const usedRam   = totalRam - freeRam;
  const loadAvg   = os.loadavg();
  const cpuCount  = os.cpus().length;
  const uptimeSec = process.uptime();
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = Math.floor(uptimeSec % 60);
  const isProd    = process.env.NODE_ENV === 'production';

  const base = {
    uptimeFormatted:    `${h}j ${m}m ${s}d`,
    heapUsedMB:         Math.round(mem.heapUsed  / 1024 / 1024),
    heapTotalMB:        Math.round(mem.heapTotal / 1024 / 1024),
    rssMB:              Math.round(mem.rss        / 1024 / 1024),
    systemRamUsedMB:    Math.round(usedRam   / 1024 / 1024),
    systemRamTotalMB:   Math.round(totalRam  / 1024 / 1024),
    ramUsedPct:         Math.round((usedRam / totalRam) * 100),
    loadAvg1m:          loadAvg[0].toFixed(2),
    loadAvg5m:          loadAvg[1].toFixed(2),
    loadAvg15m:         loadAvg[2].toFixed(2),
    cpuCount,
    nodeVersion:        process.version,
    platform:           os.platform(),
    env:                isProd ? 'production' : 'development',
  };

  if (isProd) {
    base.extendedReport = true;
    base.osUptime       = Math.floor(os.uptime() / 3600) + ' jam';
    base.hostname       = os.hostname();
    base.loadWarning    = parseFloat(base.loadAvg1m) > cpuCount ? '⚠️ CPU load tinggi!' : 'OK';
    base.ramWarning     = base.ramUsedPct > 85 ? '⚠️ RAM hampir penuh!' : 'OK';
  }

  return base;
}

// ─── PM2 Log Reader ────────────────────────────────────────────────────────────
async function getPM2Logs(lines = 100) {
  const isProd = process.env.NODE_ENV === 'production';

  // Strategy 1: pm2 CLI (works in production)
  try {
    const { stdout, stderr } = await execAsync(
      `pm2 logs --nostream --lines ${lines} 2>&1`,
      { timeout: 8000 }
    );
    const combined = (stdout + '\n' + stderr).trim();
    if (combined.length > 20) return { source: 'pm2-cli', logs: combined.slice(-8000) };
  } catch {}

  // Strategy 2: Read PM2 log files directly
  try {
    const pm2LogDir = path.join(os.homedir(), '.pm2', 'logs');
    if (fs.existsSync(pm2LogDir)) {
      const files = fs.readdirSync(pm2LogDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({ f, mtime: fs.statSync(path.join(pm2LogDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 4)
        .map(({ f }) => f);

      const content = files.map(f => {
        const full = fs.readFileSync(path.join(pm2LogDir, f), 'utf8');
        const tail = full.split('\n').slice(-Math.floor(lines / files.length)).join('\n');
        return `--- ${f} ---\n${tail}`;
      }).join('\n\n');

      if (content.trim().length > 20) return { source: 'pm2-files', logs: content.slice(-8000) };
    }
  } catch {}

  // Strategy 3: Rolling error buffer (always available)
  if (errorLog.length > 0) {
    const txt = errorLog.map(e => `[${e.ts}] ${e.label}: ${e.message}`).join('\n');
    return { source: 'in-memory-errors', logs: txt };
  }

  return {
    source: 'unavailable',
    logs: isProd
      ? 'PM2 tidak ditemukan. Pastikan bot dijalankan dengan: pm2 start index.js --name bot'
      : 'PM2 tidak tersedia di lingkungan development (Replit). Log error ada di console.',
  };
}

// ─── NeonDB Health ─────────────────────────────────────────────────────────────
async function getDBHealth() {
  const start = Date.now();
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN data->>'history' != '[]' THEN 1 ELSE 0 END) AS active FROM sessions"
    );
    const latencyMs = Date.now() - start;
    return {
      status:    'OK',
      latencyMs,
      totalSessions:  parseInt(rows[0].total  ?? 0),
      activeSessions: parseInt(rows[0].active ?? 0),
      inMemory:       sessions.size,
    };
  } catch (err) {
    return { status: 'ERROR', error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── Source Code Reader ────────────────────────────────────────────────────────
const ADMIN_FILES = [
  'index.js',
  'src/config.js',
  'src/prompts.js',
  'src/utils/session.js',
  'src/router.js',
  'src/sanitizer.js',
  'src/admin.js',
  'src/menus.js',
  'src/handlers.js',
  'src/scheduler.js',
  'package.json',
  'replit.md',
];

// Chars per file untuk Full Audit — 1000 × 12 file ≈ 3000 token input
const CHARS_PER_FILE = 1000;

function readProjectFiles(names = ADMIN_FILES, charsPerFile = CHARS_PER_FILE) {
  return names.map(name => {
    try {
      const content = fs.readFileSync(path.join(PROJECT_ROOT, name), 'utf8');
      const snippet = content.slice(0, charsPerFile);
      const truncated = content.length > charsPerFile ? ` [+${content.length - charsPerFile} chars truncated]` : '';
      return `=== ${name}${truncated} ===\n${snippet}\n`;
    } catch {
      return `=== ${name} === [tidak ditemukan]\n`;
    }
  }).join('\n---\n');
}

// ─── Base Prompt ───────────────────────────────────────────────────────────────
const AUDIT_SYSTEM_PROMPT = `Kamu adalah senior code auditor dan DevOps AI assistant untuk bot Telegram Node.js ini.

Tugasmu:
- Identifikasi bug nyata atau potensial
- Temukan security issues dan kerentanan
- Analisa log untuk error berulang, memory leak, atau anomali
- Sarankan optimasi performa berdasarkan data nyata (bukan asumsi)
- Jawab pertanyaan teknis dengan presisi
- Berikan rekomendasi yang actionable dan spesifik

FORMAT OUTPUT — WAJIB IKUTI PERSIS:
Hanya gunakan 4 tag HTML ini (tidak ada yang lain):
  <b>teks</b>        → section header
  <i>teks</i>        → catatan / caveat
  <code>teks</code>  → nama fungsi / variabel / nilai inline
  <pre><code>
teks
  </code></pre>      → contoh kode

DILARANG KERAS: <ul>, <ol>, <li>, <br>, <h1>-<h6>, markdown **, ##
Untuk daftar: gunakan "- item" manual.`;

// ─── analyzeCode: source code only ────────────────────────────────────────────
// Budget: 12 file × 1000 chars = 12000 chars ≈ 3000 token → aman di bawah 6K TPM
async function analyzeCode(question, files = ADMIN_FILES) {
  if (!groqAdmin) throw new Error('GROQ Admin tidak tersedia (set GROQ_ADMIN_API_KEY atau GROQ_API_KEY)');

  const codeContent = readProjectFiles(files, CHARS_PER_FILE);
  const completion  = await groqAdmin.chat.completions.create({
    model:       ADMIN_MODEL,
    messages: [
      { role: 'system', content: AUDIT_SYSTEM_PROMPT },
      { role: 'user',   content: `Source code:\n\n${codeContent}\n\n---\nTugas: ${question}` },
    ],
    temperature: 0.2,
    max_tokens:  2048,
  });

  // Strip Qwen3 think blocks sebelum dikembalikan
  const raw = completion.choices[0]?.message?.content || 'Tidak ada response dari AI.';
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ─── analyzeWithContext: code + logs + health + DB ────────────────────────────
// Budget ketat: health ~200 + DB ~100 + logs ~500 + code ~1500 + question ~200
// Total input ≈ 2500 token → output 2048 → total < 5000, aman di bawah 6K TPM
const CONTEXT_FILES = ['src/router.js', 'src/handlers.js', 'src/admin.js', 'index.js'];

async function analyzeWithContext(question) {
  if (!groqAdmin) throw new Error('GROQ Admin tidak tersedia');

  const [pmResult, dbHealth] = await Promise.all([getPM2Logs(50), getDBHealth()]);
  const health = getSystemHealth();

  const healthBlock = [
    `Uptime: ${health.uptimeFormatted} | Heap: ${health.heapUsedMB}/${health.heapTotalMB}MB`,
    `RAM: ${health.systemRamUsedMB}/${health.systemRamTotalMB}MB (${health.ramUsedPct}%) | RSS: ${health.rssMB}MB`,
    `CPU load: ${health.loadAvg1m} (1m) ${health.loadAvg5m} (5m) | Cores: ${health.cpuCount}`,
    `Node: ${health.nodeVersion} | Env: ${health.env}`,
    health.extendedReport ? `Host: ${health.hostname} | OS up: ${health.osUptime} | CPU: ${health.loadWarning} | RAM: ${health.ramWarning}` : '',
  ].filter(Boolean).join('\n');

  const dbBlock = dbHealth.status === 'OK'
    ? `OK | ${dbHealth.latencyMs}ms | total: ${dbHealth.totalSessions} | aktif: ${dbHealth.activeSessions}`
    : `ERROR: ${dbHealth.error}`;

  // Log: ambil 50 baris, potong di 2000 chars
  const logBlock = `[${pmResult.source}]\n${pmResult.logs.slice(-2000)}`;

  // Kode: hanya file kunci, 600 chars per file
  const codeContent = readProjectFiles(CONTEXT_FILES, 600);

  const userContent = [
    `[HEALTH]\n${healthBlock}`,
    `[DB] ${dbBlock}`,
    `[LOGS]\n${logBlock}`,
    `[CODE]\n${codeContent}`,
    `[TUGAS] ${question}`,
  ].join('\n\n');

  const completion = await groqAdmin.chat.completions.create({
    model:       ADMIN_MODEL,
    messages: [
      { role: 'system', content: AUDIT_SYSTEM_PROMPT },
      { role: 'user',   content: userContent },
    ],
    temperature: 0.2,
    max_tokens:  2048,
  });

  const rawCtx = completion.choices[0]?.message?.content || 'Tidak ada response dari AI.';
  return rawCtx.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ─── Daily Health Digest (untuk scheduler) ────────────────────────────────────
async function buildDailyDigest() {
  const [pmResult, dbHealth] = await Promise.all([getPM2Logs(100), getDBHealth()]);
  const health = getSystemHealth();

  const question = [
    'Lakukan analisa harian (daily health check) berdasarkan data berikut.',
    'Fokus pada:',
    '- Error berulang atau pattern aneh di log',
    '- Indikasi memory leak (heap terus naik?)',
    '- Performa DB (latency, jumlah session)',
    '- Rekomendasi aksi konkret jika ada masalah',
    '- Berikan penilaian kesehatan sistem: SEHAT / PERHATIAN / KRITIS',
  ].join('\n');

  return analyzeWithContext(question);
}

module.exports = {
  groqAdmin,
  ADMIN_MODEL,
  ADMIN_FILES,
  isAdmin,
  readProjectFiles,
  analyzeCode,
  analyzeWithContext,
  buildDailyDigest,
  getSystemHealth,
  getPM2Logs,
  getDBHealth,
  pushError,
};
