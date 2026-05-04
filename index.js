require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_USERS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(',').map(Number)
  : [];

if (!BOT_TOKEN || !GEMINI_KEY) {
  console.error('❌ TELEGRAM_BOT_TOKEN dan GEMINI_API_KEY wajib diisi di .env');
  process.exit(1);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

const SYSTEM_PROMPT = `Kamu adalah asisten AI yang cerdas, adaptif, dan to the point.

Karakter:
- Jawab langsung dan ringkas tanpa basa-basi berlebihan
- Tidak ada disclaimer atau warning yang tidak perlu
- Adaptif terhadap konteks percakapan — casual ya casual, teknis ya teknis
- Gunakan Bahasa Indonesia. Bahasa Inggris hanya untuk istilah teknis dan kode
- Jujur — kalau tidak tahu, bilang tidak tahu

Format respons (WAJIB HTML Telegram):
- Gunakan <b>bold</b> untuk poin penting
- Gunakan <code>kode inline</code> untuk kode pendek
- Gunakan <pre><code>blok kode</code></pre> untuk kode panjang
- Gunakan <i>italic</i> seperlunya
- Paragraf pendek, maksimal 3-4 baris per blok
- JANGAN gunakan markdown (**, __, ##, dll)
- JANGAN gunakan tabel`;

// ─── State ────────────────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { history: [], mode: 'general' });
  }
  return sessions.get(chatId);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function isAllowed(userId) {
  if (ALLOWED_USERS.length === 0) return true;
  return ALLOWED_USERS.includes(userId);
}

function authMiddleware(ctx, next) {
  if (!isAllowed(ctx.from?.id)) {
    console.log(`⛔ Akses ditolak untuk User ID: ${ctx.from?.id}`);
    return ctx.reply('⛔ Akses tidak diizinkan.');
  }
  return next();
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
const mainMenu = Markup.inlineKeyboard([
  [
    Markup.button.callback('💬 Chat Baru', 'new_chat'),
    Markup.button.callback('🗑️ Hapus History', 'clear_history'),
  ],
  [
    Markup.button.callback('🧠 Mode Coding', 'mode_coding'),
    Markup.button.callback('💡 Mode General', 'mode_general'),
  ],
  [Markup.button.callback('ℹ️ Info', 'info')],
]);

const miniMenu = Markup.inlineKeyboard([
  [Markup.button.callback('📋 Menu', 'show_menu')],
]);

// ─── Gemini ───────────────────────────────────────────────────────────────────
async function askGemini(chatId, userMessage) {
  const session = getSession(chatId);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash', // ✅ Menggunakan model stabil yang valid
    systemInstruction: SYSTEM_PROMPT,
  });

  // Ambil history (maksimal 20 pesan terakhir biar token nggak jebol)
  const chat = model.startChat({ 
    history: session.history.slice(-20) 
  });

  // Kirim pesan ke Gemini
  const result = await chat.sendMessage(userMessage);
  const response = result.response.text();

  // ✅ Simpan ke history HANYA jika berhasil (tidak error)
  session.history.push({ role: 'user', parts: [{ text: userMessage }] });
  session.history.push({ role: 'model', parts: [{ text: response }] });

  return response;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendLong(ctx, text, extra = {}) {
  const MAX = 4000;
  const chunks = [];

  if (text.length <= MAX) {
    chunks.push(text);
  } else {
    const lines = text.split('\n');
    let current = '';
    for (const line of lines) {
      if ((current + line).length > MAX) {
        chunks.push(current.trim());
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    try {
      await ctx.replyWithHTML(chunks[i], isLast ? extra : {});
    } catch (err) {
      // ✅ Fallback Dev: Kalau HTML berantakan (gara2 Gemini), kirim teks biasa biar bot nggak crash
      console.warn(`⚠️ [Dev Warning] Gagal render HTML, kirim sbg teks. Error: ${err.message}`);
      await ctx.reply(chunks[i], isLast ? extra : {});
    }
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────
bot.start(authMiddleware, async (ctx) => {
  const name = ctx.from.first_name || 'bro';
  await ctx.replyWithHTML(
    `Halo <b>${name}</b>! 👋\n\nAku siap membantu. Ketik pesan langsung atau pilih menu:`,
    mainMenu
  );
});

bot.command('menu', authMiddleware, async (ctx) => {
  await ctx.reply('Menu:', mainMenu);
});

// ─── Callbacks ────────────────────────────────────────────────────────────────
bot.action('new_chat', authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.history = [];
  await ctx.answerCbQuery('✅ Chat baru dimulai');
  await ctx.replyWithHTML('Chat baru dimulai. Silakan ketik pertanyaanmu.');
});

bot.action('clear_history', authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.history = [];
  await ctx.answerCbQuery('🗑️ History dihapus');
  await ctx.reply('History percakapan dihapus.');
});

bot.action('mode_coding', authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.mode = 'coding';
  await ctx.answerCbQuery('🧠 Mode Coding aktif');
  await ctx.replyWithHTML('🧠 <b>Mode Coding</b> aktif.\n\nFokus ke debugging, review kode, dan technical questions.');
});

bot.action('mode_general', authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.mode = 'general';
  await ctx.answerCbQuery('💡 Mode General aktif');
  await ctx.replyWithHTML('💡 <b>Mode General</b> aktif.');
});

bot.action('info', authMiddleware, async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.answerCbQuery();
  await ctx.replyWithHTML(
    [
      '<b>ℹ️ Info Bot</b>',
      '',
      `Model: <code>gemini-1.5-flash</code>`, // ✅ Update info
      `Mode: <code>${session.mode}</code>`,
      `History: <code>${session.history.length} pesan</code>`,
    ].join('\n'),
    mainMenu
  );
});

bot.action('show_menu', authMiddleware, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Menu:', mainMenu);
});

// ─── Message Handler ──────────────────────────────────────────────────────────
bot.on('text', authMiddleware, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const userText = ctx.message.text.trim();

  // ✅ Logging untuk mempermudah dev
  console.log(`\n[📥] Pesan dari ${ctx.from.first_name}: ${userText}`);

  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(
    () => ctx.sendChatAction('typing').catch(() => {}),
    4000
  );

  try {
    const prompt =
      session.mode === 'coding' ? `[Mode Coding] ${userText}` : userText;

    const response = await askGemini(chatId, prompt);
    clearInterval(typingInterval);

    console.log(`[📤] Respons bot (Preview): ${response.substring(0, 50).replace(/\n/g, ' ')}...`);

    await sendLong(ctx, response, {
      reply_parameters: { message_id: ctx.message.message_id },
      ...miniMenu,
    });
  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ [Error Gemini]:', err);

    const errMsg = err.message?.includes('quota')
      ? '⚠️ Rate limit Gemini tercapai. Tunggu sebentar dan coba lagi.'
      : `❌ Error API: <code>${escapeHtml(err.message)}</code>`;

    await ctx.replyWithHTML(errMsg);
  }
});

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch({ dropPendingUpdates: true });
console.log('🤖 Bot jalan dalam Mode Development...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));