require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const fs   = require('fs');
const path = require('path');

// ─── Validation ───────────────────────────────────────────────────────────────
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const GROQ_KEY      = process.env.GROQ_API_KEY;
const ALLOWED_USERS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(',').map(Number)
  : [];

if (!BOT_TOKEN || !GEMINI_KEY) {
  console.error('❌ TELEGRAM_BOT_TOKEN dan GEMINI_API_KEY wajib diisi di .env');
  process.exit(1);
}

// ─── Model Registry ───────────────────────────────────────────────────────────
// Source: ai.google.dev/gemini-api/docs/models — verified May 2026
const MODELS = {
  lite:    'gemini-2.0-flash-lite',
  flash:   'gemini-2.0-flash',
  flash25: 'gemini-2.5-flash',
  pro:     'gemini-2.5-pro-preview-05-06',
};

// Source: api.groq.com/openai/v1/models — verified May 2026 (live API check)
const GROQ_MODELS = {
  instant:   'llama-3.1-8b-instant',
  versatile: 'llama-3.3-70b-versatile',
  qwen:      'qwen/qwen3-32b',
};

const MODEL_LABELS = {
  auto:                 '🔄 Auto',
  [MODELS.lite]:        '⚡ Flash Lite',
  [MODELS.flash]:       '🔥 Flash 2.0',
  [MODELS.flash25]:     '✨ Flash 2.5',
  [MODELS.pro]:         '🧠 Pro 2.5',
  [GROQ_MODELS.instant]:   '⚡ Llama 8B',
  [GROQ_MODELS.versatile]: '🦙 Llama 70B',
  [GROQ_MODELS.qwen]:      '🐉 Qwen3 32B',
};

const MODEL_SHORT = {
  auto:                 'Auto',
  [MODELS.lite]:        'Lite',
  [MODELS.flash]:       'Flash 2.0',
  [MODELS.flash25]:     'Flash 2.5',
  [MODELS.pro]:         'Pro 2.5',
  [GROQ_MODELS.instant]:   'Llama 8B',
  [GROQ_MODELS.versatile]: 'Llama 70B',
  [GROQ_MODELS.qwen]:      'Qwen3 32B',
};

// ─── System Prompts per Mode (rules: docs/prompt-audit.md) ───────────────────
const SYSTEM_PROMPTS = {
  general: `Kamu adalah asisten AI yang cerdas, adaptif, dan to the point.

Karakter:
- Jawab langsung dan ringkas tanpa basa-basi berlebihan
- Tidak ada disclaimer atau warning yang tidak perlu
- Adaptif — casual ya casual, teknis ya teknis
- Gunakan Bahasa Indonesia. Bahasa Inggris hanya untuk istilah teknis dan kode
- Jujur — kalau tidak tahu, bilang tidak tahu

Tag HTML yang BOLEH dipakai (hanya ini yang valid di Telegram):
- <b>bold</b> untuk poin penting
- <code>kode inline</code> untuk kode pendek / nama fungsi / variabel
- <pre><code>blok kode</code></pre> untuk kode panjang
- <i>italic</i> seperlunya
- Paragraf pendek, max 3-4 baris per blok
- DILARANG KERAS: **, __, ##, tabel, <ul>, <ol>, <li>, <h1>-<h6>, <br>, <hr>, semua tag HTML lain selain yang tercantum di atas`,

  coding: `Kamu adalah senior software engineer dengan 10+ tahun pengalaman.

Perilaku:
- Jelaskan *kenapa* sebelum *bagaimana*
- Step-by-step yang langsung bisa diimplementasi
- Tunjukkan alternatif jika ada trade-off penting
- Review kritis — tunjukkan potensi bug, edge case, dan improvement
- Pertimbangkan: performa, keamanan, maintainability

Tag HTML yang BOLEH dipakai (hanya ini yang valid di Telegram):
- <pre><code class="language-xxx">kode</code></pre> untuk semua blok kode
- <code>inline</code> untuk nama variabel / fungsi / perintah
- <b>bold</b> untuk poin kritis
- <i>italic</i> untuk catatan / caveat
- DILARANG KERAS: **, __, ##, tabel, <ul>, <ol>, <li>, <h1>-<h6>, <br>, <hr>, semua tag HTML lain selain yang tercantum di atas`,

  analyst: `Kamu adalah analis yang tajam dan terstruktur.

Perilaku:
- Breakdown masalah sebelum menjawab
- Identifikasi asumsi tersembunyi dalam pertanyaan
- Sajikan perspektif dari beberapa sudut pandang
- Kesimpulan actionable, bukan sekadar observasi
- Jika ada data/angka, interpretasikan — jangan hanya kutip

Tag HTML yang BOLEH dipakai (hanya ini yang valid di Telegram):
- <b>bold</b> untuk heading tiap bagian
- <code>angka / data penting</code>
- Struktur: Konteks → Analisis → Implikasi → Rekomendasi
- DILARANG KERAS: **, __, ##, tabel, <ul>, <ol>, <li>, <h1>-<h6>, <br>, <hr>, semua tag HTML lain selain yang tercantum di atas`,

  creative: `Kamu adalah kreator ide yang bebas dan tidak terbatas.

Perilaku:
- Eksplorasi ide dari sudut yang tidak terduga
- Tidak ada batasan konvensional — yang penting relevan dan menarik
- Berikan beberapa variasi / alternatif
- Boleh out-of-the-box, kombinasikan konsep dari domain berbeda
- Pendek dan punchy, bukan bertele-tele

Tag HTML yang BOLEH dipakai (hanya ini yang valid di Telegram):
- <b>bold</b> untuk judul ide
- <i>italic</i> untuk nuansa dan detail
- DILARANG KERAS: **, __, ##, tabel, <ul>, <ol>, <li>, <h1>-<h6>, <br>, <hr>, semua tag HTML lain selain yang tercantum di atas`,
};

// ─── Session Persistence ──────────────────────────────────────────────────────
const SESSION_FILE = path.join(__dirname, 'sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))));
    }
  } catch { /* corrupt — start fresh */ }
  return new Map();
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), 'utf8');
  } catch (e) {
    console.warn('⚠️ Gagal simpan session:', e.message);
  }
}

const sessions = loadSessions();

function getSession(chatId) {
  const key = String(chatId);
  if (!sessions.has(key)) {
    sessions.set(key, { history: [], mode: 'general', model: 'auto' });
  }
  return sessions.get(key);
}

// ─── Init Clients ─────────────────────────────────────────────────────────────
const bot   = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const groq  = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY }) : null;

// ─── Auth ─────────────────────────────────────────────────────────────────────
function isAllowed(userId) {
  if (ALLOWED_USERS.length === 0) return true;
  return ALLOWED_USERS.includes(userId);
}

function authMiddleware(ctx, next) {
  if (!isAllowed(ctx.from?.id)) {
    console.log(`⛔ Akses ditolak — User ID: ${ctx.from?.id}`);
    return ctx.reply('⛔ Akses tidak diizinkan.');
  }
  return next();
}

// ─── Complexity Detector ──────────────────────────────────────────────────────
function isComplex(text) {
  const words   = text.split(/\s+/).length;
  const hasCode = /```|function |class |import |const |def |async |await |SELECT |CREATE /.test(text);
  const isDeep  = /\banalisis\b|\bjelaskan detail\b|\bbandingkan\b|\bevaluasi\b|\brancang\b|\barsitektur\b|\boptimasi\b|\bstrategi\b/i.test(text);
  return hasCode || isDeep || words > 80;
}

// ─── History Converter: Gemini → Groq (OpenAI format) ────────────────────────
function historyToGroq(history, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const msg of history.slice(-20)) {
    const textParts = msg.parts.filter(p => p.text);
    const hasMedia  = msg.parts.some(p => p.inlineData);
    const content   = textParts.map(p => p.text).join('')
                    + (hasMedia ? '\n[Pengguna mengirim gambar/file]' : '');
    messages.push({
      role:    msg.role === 'model' ? 'assistant' : 'user',
      content: content || '[...]',
    });
  }
  return messages;
}

// ─── Gemini Ask (internal) ────────────────────────────────────────────────────
async function askWithGemini(chatId, userMessage, imageParts = [], modelCascade = []) {
  const session      = getSession(chatId);
  const systemPrompt = SYSTEM_PROMPTS[session.mode] || SYSTEM_PROMPTS.general;
  const msgParts     = imageParts.length > 0
    ? [...imageParts, { text: userMessage || 'Analisis konten ini.' }]
    : userMessage;

  let lastErr;
  for (const modelId of modelCascade) {
    try {
      const model  = genAI.getGenerativeModel({ model: modelId, systemInstruction: systemPrompt });
      const chat   = model.startChat({ history: session.history.slice(-20) });
      const result = await chat.sendMessage(msgParts);
      const text   = result.response.text();

      // Persist to session history (Gemini format)
      const userPart = imageParts.length > 0
        ? { role: 'user', parts: [...imageParts, { text: userMessage || 'Analisis konten ini.' }] }
        : { role: 'user', parts: [{ text: userMessage }] };
      session.history.push(userPart);
      session.history.push({ role: 'model', parts: [{ text }] });
      if (session.history.length > 40) session.history = session.history.slice(-40);
      saveSessions();

      return { text, usedModel: modelId, provider: 'gemini' };

    } catch (err) {
      lastErr = err;
      const isFallbackable = err.status === 429 || err.status === 404 || err.status === 503
        || err.message?.includes('quota')
        || err.message?.includes('not found')
        || err.message?.includes('overloaded');

      const nextIdx = modelCascade.indexOf(modelId) + 1;
      if (isFallbackable && nextIdx < modelCascade.length) {
        console.warn(`[Omni-Router] Gemini ${modelId} failed (${err.status ?? err.message?.slice(0,40)}), trying ${modelCascade[nextIdx]}...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── Groq Ask (internal) ──────────────────────────────────────────────────────
async function askWithGroq(chatId, userMessage, modelId) {
  const session      = getSession(chatId);
  const systemPrompt = SYSTEM_PROMPTS[session.mode] || SYSTEM_PROMPTS.general;

  const messages = historyToGroq(session.history, systemPrompt);
  messages.push({ role: 'user', content: userMessage });

  const completion = await groq.chat.completions.create({
    model:       modelId,
    messages,
    temperature: 0.7,
    max_tokens:  4096,
  });

  const text = completion.choices[0]?.message?.content || '';

  // Persist to session history (Gemini format — single source of truth)
  session.history.push({ role: 'user',  parts: [{ text: userMessage }] });
  session.history.push({ role: 'model', parts: [{ text }] });
  if (session.history.length > 40) session.history = session.history.slice(-40);
  saveSessions();

  return { text, usedModel: modelId, provider: 'groq' };
}

// ─── Groq Tier 4 Fallback Chain ───────────────────────────────────────────────
async function groqFallback(chatId, userMessage) {
  try {
    console.log(`[Omni-Router] Tier 4: Groq Versatile (${GROQ_MODELS.versatile})`);
    return await askWithGroq(chatId, userMessage, GROQ_MODELS.versatile);
  } catch (err) {
    console.warn('[Omni-Router] Tier 4 Versatile failed, trying Qwen...');
    return await askWithGroq(chatId, userMessage, GROQ_MODELS.qwen);
  }
}

// ─── Omni-Router: smartRequest ────────────────────────────────────────────────
async function smartRequest(chatId, userMessage, imageParts = []) {
  const session  = getSession(chatId);
  const groqOK   = !!groq;
  const msgLen   = userMessage.length;
  const coding   = session.mode === 'coding';
  const complex  = isComplex(userMessage);

  // ── Multimodal (image/PDF) → always Gemini (Groq free tier: text only) ──
  if (imageParts.length > 0) {
    console.log('[Omni-Router] Multimodal detected -> Gemini only');
    return askWithGemini(chatId, userMessage, imageParts,
      [MODELS.flash25, MODELS.flash, MODELS.lite]);
  }

  // ── User-chosen model (not auto) ──────────────────────────────────────────
  if (session.model !== 'auto') {
    const isGroqModel = Object.values(GROQ_MODELS).includes(session.model);

    if (isGroqModel && groqOK) {
      console.log(`[Omni-Router] User model (Groq) -> ${session.model}`);
      return askWithGroq(chatId, userMessage, session.model);
    }

    const geminiCascade = [session.model, MODELS.flash25, MODELS.flash, MODELS.lite]
      .filter((v, i, a) => a.indexOf(v) === i);
    try {
      return await askWithGemini(chatId, userMessage, [], geminiCascade);
    } catch (err) {
      const isQuota = err.status === 429 || err.message?.includes('quota');
      if (isQuota && groqOK) {
        console.log('[Omni-Router] User model quota hit -> Tier 4 Groq fallback');
        return groqFallback(chatId, userMessage);
      }
      throw err;
    }
  }

  // ── Auto routing ──────────────────────────────────────────────────────────

  // Tier 1 — Short/instant → Groq Llama 8B
  if (groqOK && msgLen < 40) {
    console.log(`[Omni-Router] Short query (${msgLen} chars) -> Tier 1: Llama 8B (Groq)`);
    try {
      return await askWithGroq(chatId, userMessage, GROQ_MODELS.instant);
    } catch (err) {
      console.warn('[Omni-Router] Tier 1 failed, cascading to Tier 2...');
      // fall through
    }
  }

  // Tier 3 — Coding mode or complex query → Gemini Flash 2.5 (Pro excluded: 404 on free tier)
  if (coding || complex) {
    console.log(`[Omni-Router] ${coding ? 'Coding mode' : 'Complex query'} -> Tier 3: Gemini Flash 2.5`);
    try {
      return await askWithGemini(chatId, userMessage, [],
        [MODELS.flash25, MODELS.flash, MODELS.lite]);
    } catch (err) {
      const isQuota = err.status === 429 || err.message?.includes('quota');
      if (isQuota && groqOK) {
        console.log('[Omni-Router] Gemini Pro quota -> Tier 4: Groq Versatile');
        return groqFallback(chatId, userMessage);
      }
      throw err;
    }
  }

  // Tier 2 — General → Gemini Flash 2.5
  console.log('[Omni-Router] General query -> Tier 2: Gemini Flash 2.5');
  try {
    return await askWithGemini(chatId, userMessage, [],
      [MODELS.flash25, MODELS.flash, MODELS.lite]);
  } catch (err) {
    const isQuota = err.status === 429 || err.message?.includes('quota');
    if (isQuota && groqOK) {
      console.log('[Omni-Router] Gemini Flash quota -> Tier 4: Groq Versatile');
      return groqFallback(chatId, userMessage);
    }
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(text = '') {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function downloadAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download gagal: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

async function sendLong(ctx, text, extra = {}) {
  const MAX = 4000;
  if (text.length <= MAX) {
    try { return await ctx.replyWithHTML(text, extra); }
    catch { return await ctx.reply(text, extra); }
  }

  const lines  = text.split('\n');
  const chunks = [];
  let current  = '';

  for (const line of lines) {
    if ((current + line).length > MAX) {
      if (current.trim()) chunks.push(current.trim());
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.trim()) chunks.push(current.trim());

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    try { await ctx.replyWithHTML(chunks[i], isLast ? extra : {}); }
    catch { await ctx.reply(chunks[i], isLast ? extra : {}); }
  }
}

// ─── Menus ────────────────────────────────────────────────────────────────────
const MODE_EMOJI = { general: '💡', coding: '🧠', analyst: '📊', creative: '🎨' };

function buildMainMenu(session) {
  const modeLabel  = `${MODE_EMOJI[session?.mode] ?? '💡'} ${(session?.mode ?? 'general').charAt(0).toUpperCase() + (session?.mode ?? 'general').slice(1)}`;
  const modelLabel = `🤖 ${MODEL_SHORT[session?.model] ?? 'Auto'}`;
  return Markup.inlineKeyboard([
    [Markup.button.callback('💬 Chat Baru', 'new_chat'), Markup.button.callback('🗑️ Hapus History', 'clear_history')],
    [Markup.button.callback(`⚙️ Mode: ${modeLabel}`, 'mode_menu'), Markup.button.callback(modelLabel, 'model_menu')],
    [Markup.button.callback('ℹ️ Info', 'info')],
  ]);
}

const modeMenu = Markup.inlineKeyboard([
  [Markup.button.callback('💡 General', 'mode_general'), Markup.button.callback('🧠 Coding', 'mode_coding')],
  [Markup.button.callback('📊 Analyst', 'mode_analyst'), Markup.button.callback('🎨 Creative', 'mode_creative')],
  [Markup.button.callback('« Kembali', 'show_menu')],
]);

const modelMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🔄 Auto Cascade (Recommended)', 'model_auto')],
  [Markup.button.callback('✨ Gemini Flash 2.5', 'model_flash25'), Markup.button.callback('🧠 Gemini Pro 2.5', 'model_pro')],
  [Markup.button.callback('🔥 Gemini Flash 2.0', 'model_flash'), Markup.button.callback('⚡ Gemini Lite', 'model_lite')],
  [Markup.button.callback('⚡ Llama 8B (Groq)', 'model_groq_instant'), Markup.button.callback('🦙 Llama 70B (Groq)', 'model_groq_versatile')],
  [Markup.button.callback('🐉 Qwen3 32B (Groq)', 'model_groq_qwen')],
  [Markup.button.callback('« Kembali', 'show_menu')],
]);

const miniMenu = Markup.inlineKeyboard([
  [Markup.button.callback('📋 Menu', 'show_menu'), Markup.button.callback('💬 Chat Baru', 'new_chat')],
]);

// ─── Commands ─────────────────────────────────────────────────────────────────
bot.start(authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  const name    = ctx.from.first_name || 'bro';
  await ctx.replyWithHTML(
    `Halo <b>${name}</b>! 👋\n\nAku siap membantu. Ketik pesan atau pilih menu:`,
    buildMainMenu(session)
  );
});

bot.command('menu', authMiddleware, async (ctx) => {
  await ctx.reply('Menu:', buildMainMenu(getSession(ctx.chat.id)));
});

bot.command('new', authMiddleware, async (ctx) => {
  const session   = getSession(ctx.chat.id);
  session.history = [];
  saveSessions();
  await ctx.reply('✅ Chat baru dimulai.');
});

bot.command('info', authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.replyWithHTML(buildInfoText(session), buildMainMenu(session));
});

// ─── Callbacks ────────────────────────────────────────────────────────────────
function buildInfoText(session) {
  return [
    '<b>ℹ️ Info Bot</b>',
    '',
    `Mode: <code>${session.mode}</code>`,
    `Model: <code>${MODEL_LABELS[session.model] ?? session.model}</code>`,
    `History: <code>${Math.floor(session.history.length / 2)} exchange</code>`,
    '',
    '<b>Gemini Models:</b>',
    `✨ <code>${MODELS.flash25}</code>`,
    `🧠 <code>${MODELS.pro}</code>`,
    `🔥 <code>${MODELS.flash}</code>`,
    '',
    `<b>Groq Models:</b> ${groq ? 'aktif' : '⚠️ tidak aktif (no GROQ_API_KEY)'}`,
    groq ? `⚡ <code>${GROQ_MODELS.instant}</code>` : '',
    groq ? `🦙 <code>${GROQ_MODELS.versatile}</code>` : '',
    groq ? `🐉 <code>${GROQ_MODELS.qwen}</code>` : '',
  ].filter(l => l !== '').join('\n');
}

bot.action('show_menu', authMiddleware, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Menu:', buildMainMenu(getSession(ctx.chat.id)));
});

bot.action('new_chat', authMiddleware, async (ctx) => {
  const session   = getSession(ctx.chat.id);
  session.history = [];
  saveSessions();
  await ctx.answerCbQuery('✅ Chat baru dimulai');
  await ctx.reply('Chat baru dimulai. Silakan ketik pertanyaanmu.');
});

bot.action('clear_history', authMiddleware, async (ctx) => {
  const session   = getSession(ctx.chat.id);
  session.history = [];
  saveSessions();
  await ctx.answerCbQuery('🗑️ History dihapus');
  await ctx.reply('History percakapan dihapus.');
});

bot.action('mode_menu',  authMiddleware, async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('Pilih mode:', modeMenu); });
bot.action('model_menu', authMiddleware, async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('Pilih model:', modelMenu); });

bot.action('info', authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.answerCbQuery();
  await ctx.replyWithHTML(buildInfoText(session), buildMainMenu(session));
});

// Mode actions
const MODE_ACTIONS = [
  ['mode_general',  'general',  '💡 Mode General aktif'],
  ['mode_coding',   'coding',   '🧠 Mode Coding aktif'],
  ['mode_analyst',  'analyst',  '📊 Mode Analyst aktif'],
  ['mode_creative', 'creative', '🎨 Mode Creative aktif'],
];
for (const [action, mode, label] of MODE_ACTIONS) {
  bot.action(action, authMiddleware, async (ctx) => {
    const session = getSession(ctx.chat.id);
    session.mode  = mode;
    saveSessions();
    await ctx.answerCbQuery(`✅ ${label}`);
    await ctx.replyWithHTML(`<b>${label}</b>`);
  });
}

// Model actions
const MODEL_ACTIONS = [
  ['model_auto',          'auto',                  '🔄 Auto Cascade aktif'],
  ['model_flash25',       MODELS.flash25,          '✨ Gemini Flash 2.5 aktif'],
  ['model_pro',           MODELS.pro,              '🧠 Gemini Pro 2.5 aktif'],
  ['model_flash',         MODELS.flash,            '🔥 Gemini Flash 2.0 aktif'],
  ['model_lite',          MODELS.lite,             '⚡ Gemini Lite aktif'],
  ['model_groq_instant',  GROQ_MODELS.instant,     '⚡ Llama 8B (Groq) aktif'],
  ['model_groq_versatile',GROQ_MODELS.versatile,   '🦙 Llama 70B (Groq) aktif'],
  ['model_groq_qwen',     GROQ_MODELS.qwen,        '🐉 Qwen3 32B (Groq) aktif'],
];
for (const [action, modelKey, label] of MODEL_ACTIONS) {
  bot.action(action, authMiddleware, async (ctx) => {
    const session  = getSession(ctx.chat.id);
    session.model  = modelKey;
    saveSessions();
    await ctx.answerCbQuery(`✅ ${label}`);
    await ctx.replyWithHTML(`<b>${label}</b>`);
  });
}

// ─── Handler: Text ────────────────────────────────────────────────────────────
bot.on('text', authMiddleware, async (ctx) => {
  const chatId   = ctx.chat.id;
  const userText = ctx.message.text.trim();

  console.log(`\n[📥] ${ctx.from.first_name} (${chatId}): ${userText.slice(0, 80)}`);
  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);

  try {
    const { text, usedModel, provider } = await smartRequest(chatId, userText);
    clearInterval(typingInterval);
    console.log(`[📤] [${provider}:${usedModel}] ${text.slice(0, 60).replace(/\n/g, ' ')}...`);

    await sendLong(ctx, text, {
      reply_parameters: { message_id: ctx.message.message_id },
      ...miniMenu,
    });
  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ [Error Text]:', err.message);
    const isQuota = err.message?.includes('quota') || err.status === 429;
    const errMsg  = isQuota
      ? '⚠️ Rate limit semua provider tercapai. Tunggu sebentar dan coba lagi.'
      : `❌ Error: <code>${escapeHtml(err.message?.slice(0, 120) ?? 'Unknown')}</code>`;
    await ctx.replyWithHTML(errMsg).catch(() => ctx.reply(errMsg));
  }
});

// ─── Handler: Photo (Vision) ──────────────────────────────────────────────────
bot.on('photo', authMiddleware, async (ctx) => {
  const chatId  = ctx.chat.id;
  const caption = ctx.message.caption?.trim() || '';
  const photo   = ctx.message.photo[ctx.message.photo.length - 1];

  console.log(`\n[📸] ${ctx.from.first_name} kirim foto. Caption: "${caption}"`);
  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);

  try {
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const base64   = await downloadAsBase64(fileLink.href);
    const imgParts = [{ inlineData: { mimeType: 'image/jpeg', data: base64 } }];

    const { text, usedModel } = await smartRequest(chatId, caption, imgParts);
    clearInterval(typingInterval);
    console.log(`[📤] [gemini:${usedModel}] Vision: ${text.slice(0, 60).replace(/\n/g, ' ')}...`);

    await sendLong(ctx, text, {
      reply_parameters: { message_id: ctx.message.message_id },
      ...miniMenu,
    });
  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ [Error Vision]:', err.message);
    await ctx.replyWithHTML(`❌ Error analisis gambar: <code>${escapeHtml(err.message?.slice(0, 120))}</code>`)
      .catch(() => ctx.reply('❌ Gagal analisis gambar.'));
  }
});

// ─── Handler: Document ────────────────────────────────────────────────────────
bot.on('document', authMiddleware, async (ctx) => {
  const chatId   = ctx.chat.id;
  const doc      = ctx.message.document;
  const caption  = ctx.message.caption?.trim() || '';
  const mimeType = doc.mime_type || 'application/octet-stream';
  const fileSize = doc.file_size || 0;

  const MAX_BYTES = 5 * 1024 * 1024;
  if (fileSize > MAX_BYTES) return ctx.reply('⚠️ File terlalu besar. Maksimal 5 MB.');

  const isText = mimeType.startsWith('text/') || mimeType === 'application/json';
  const isPdf  = mimeType === 'application/pdf';

  if (!isText && !isPdf) {
    return ctx.replyWithHTML(
      `⚠️ Format tidak didukung: <code>${escapeHtml(mimeType)}</code>\n` +
      'Didukung: PDF, TXT, JS, PY, JSON, HTML, CSS, MD'
    );
  }

  console.log(`\n[📄] ${ctx.from.first_name} kirim file: ${doc.file_name} (${mimeType})`);
  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const base64   = await downloadAsBase64(fileLink.href);

    let result;
    if (isPdf) {
      // PDF → Gemini vision (Groq doesn't support binary file input)
      const fileParts = [{ inlineData: { mimeType: 'application/pdf', data: base64 } }];
      console.log('[Omni-Router] PDF detected -> Gemini only');
      result = await askWithGemini(chatId,
        caption || `Analisis dokumen PDF ini: ${doc.file_name}`,
        fileParts,
        [MODELS.flash25, MODELS.flash, MODELS.lite]
      );
    } else {
      // Text file → decode and pass as prompt (routed via smartRequest)
      const textContent = Buffer.from(base64, 'base64').toString('utf8');
      const prompt      = `File: ${doc.file_name}\n\n${textContent.slice(0, 8000)}\n\n${caption || 'Analisis file ini.'}`;
      result = await smartRequest(chatId, prompt);
    }

    clearInterval(typingInterval);
    console.log(`[📤] [${result.provider}:${result.usedModel}] Doc: ${result.text.slice(0, 60).replace(/\n/g, ' ')}...`);

    await sendLong(ctx, result.text, {
      reply_parameters: { message_id: ctx.message.message_id },
      ...miniMenu,
    });
  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ [Error Doc]:', err.message);
    await ctx.replyWithHTML(`❌ Error proses file: <code>${escapeHtml(err.message?.slice(0, 120))}</code>`)
      .catch(() => ctx.reply('❌ Gagal proses file.'));
  }
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch({ dropPendingUpdates: true });

console.log('🤖 Bot aktif — Mode: Polling | Session: Persistent File');
console.log(`📦 Gemini: ${MODELS.flash25} | ${MODELS.pro} | ${MODELS.flash} | ${MODELS.lite}`);
console.log(`📦 Groq  : ${groq ? `${GROQ_MODELS.instant} | ${GROQ_MODELS.versatile} | ${GROQ_MODELS.qwen}` : 'DISABLED (no GROQ_API_KEY)'}`);

process.once('SIGINT',  () => { saveSessions(); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { saveSessions(); bot.stop('SIGTERM'); });
