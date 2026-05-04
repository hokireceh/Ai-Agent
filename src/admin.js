'use strict';

const fs   = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const { GROQ_ADMIN_KEY, ADMIN_USERS, GROQ_MODELS } = require('./config');

const PROJECT_ROOT = path.join(__dirname, '..');
const ADMIN_MODEL  = GROQ_MODELS.qwen;
const groqAdmin    = GROQ_ADMIN_KEY ? new Groq({ apiKey: GROQ_ADMIN_KEY }) : null;

function isAdmin(userId) {
  return ADMIN_USERS.length > 0 && ADMIN_USERS.includes(userId);
}

const ADMIN_FILES = [
  'index.js',
  'src/config.js',
  'src/prompts.js',
  'src/session.js',
  'src/router.js',
  'src/sanitizer.js',
  'src/admin.js',
  'src/menus.js',
  'src/handlers.js',
  'docs/prompt-audit.md',
  'package.json',
  'replit.md',
];

function readProjectFiles(names = ADMIN_FILES) {
  return names.map(name => {
    try {
      const content = fs.readFileSync(path.join(PROJECT_ROOT, name), 'utf8');
      return `=== ${name} (${content.length} chars) ===\n${content.slice(0, 5000)}\n`;
    } catch {
      return `=== ${name} === [tidak ditemukan]\n`;
    }
  }).join('\n---\n');
}

async function analyzeCode(question, files = ADMIN_FILES) {
  if (!groqAdmin) throw new Error('GROQ Admin tidak tersedia (set GROQ_ADMIN_API_KEY atau GROQ_API_KEY)');

  const codeContent  = readProjectFiles(files);
  const systemPrompt = `Kamu adalah senior code auditor dan second AI assistant yang menganalisa source code bot Telegram Node.js ini secara mendalam.

Tugasmu:
- Identifikasi bug nyata atau potensial
- Temukan security issues dan kerentanan
- Sarankan optimasi performa
- Review arsitektur dan design patterns
- Jawab pertanyaan teknis tentang kode dengan presisi
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

  const completion = await groqAdmin.chat.completions.create({
    model: ADMIN_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Source code proyek:\n\n${codeContent}\n\n---\nPertanyaan/tugas: ${question}` },
    ],
    temperature: 0.2,
    max_tokens:  8192,
  });

  return completion.choices[0]?.message?.content || 'Tidak ada response dari AI.';
}

module.exports = { groqAdmin, ADMIN_MODEL, ADMIN_FILES, isAdmin, readProjectFiles, analyzeCode };
