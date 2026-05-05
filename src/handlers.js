'use strict';

const { ALLOWED_USERS, ADMIN_USERS, MODELS, GROQ_MODELS, MODEL_LABELS } = require('./config');
const { sessions, getSession, saveSession, saveSessions }                = require('./utils/session');
const { groq, smartRequest, askWithGemini }                              = require('./router');
const { sanitizeForTelegram, escapeHtml, downloadAsBase64, sendLong }    = require('./sanitizer');
const {
  groqAdmin, groqPool, ADMIN_MODEL, isAdmin,
  analyzeWithContext,
  getSystemHealth, getDBHealth,
} = require('./admin');
const {
  REPLY_BTN,
  buildReplyMenu,
  buildCommandPalette,
  modelMenu,
  miniMenu,
  adminMenu,
  adminMiniMenu,
} = require('./menus');

// ─── Auth ──────────────────────────────────────────────────────────────────────
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

// ─── Info text ─────────────────────────────────────────────────────────────────
function buildInfoText(session) {
  return [
    '<b>ℹ️ Info Bot</b>',
    '',
    `Model aktif: <code>${MODEL_LABELS[session.model] ?? session.model}</code>`,
    `History: <code>${Math.floor(session.history.length / 2)} exchange</code>`,
    '<i>Konteks percakapan terdeteksi otomatis.</i>',
    '',
    '<b>Gemini:</b>',
    `✨ <code>${MODELS.flash25}</code>`,
    `🧠 <code>${MODELS.pro}</code>`,
    `🔥 <code>${MODELS.flash}</code>`,
    '',
    `<b>Groq:</b> ${groq ? 'aktif' : '⚠️ tidak aktif'}`,
    groq ? `⚡ <code>${GROQ_MODELS.instant}</code>`   : '',
    groq ? `🦙 <code>${GROQ_MODELS.versatile}</code>` : '',
    groq ? `🐉 <code>${GROQ_MODELS.qwen}</code>`      : '',
  ].filter(l => l !== '').join('\n');
}

// ─── System Status Text ────────────────────────────────────────────────────────
async function buildStatusText() {
  const h  = getSystemHealth();
  const db = await getDBHealth();
  const totalSessions  = sessions.size;
  const activeSessions = [...sessions.values()].filter(v => v.history?.length > 0).length;

  const lines = [
    '<b>📊 System Status</b>', '',
    `<b>Uptime:</b> <code>${h.uptimeFormatted}</code>`,
    `<b>Heap:</b> <code>${h.heapUsedMB} MB / ${h.heapTotalMB} MB</code>`,
    `<b>RSS:</b> <code>${h.rssMB} MB</code>`,
    `<b>System RAM:</b> <code>${h.systemRamUsedMB} MB / ${h.systemRamTotalMB} MB (${h.ramUsedPct}%)</code>`,
    `<b>CPU Load:</b> <code>${h.loadAvg1m} (1m) | ${h.loadAvg5m} (5m) | ${h.loadAvg15m} (15m)</code>`,
    `<b>Node.js:</b> <code>${h.nodeVersion}</code>`,
    `<b>Environment:</b> <code>${h.env}</code>`,
  ];

  if (h.extendedReport) {
    lines.push(`<b>OS Uptime:</b> <code>${h.osUptime}</code>`);
    lines.push(`<b>Hostname:</b> <code>${h.hostname}</code>`);
    lines.push(`<b>CPU Status:</b> ${h.loadWarning}`);
    lines.push(`<b>RAM Status:</b> ${h.ramWarning}`);
  }

  lines.push('', `<b>Sessions total:</b> <code>${totalSessions}</code>`);
  lines.push(`<b>Sessions aktif:</b> <code>${activeSessions}</code>`, '');
  lines.push('<b>NeonDB:</b>');
  if (db.status === 'OK') {
    lines.push(`- Status: <code>OK</code> | Latency: <code>${db.latencyMs}ms</code>`);
    lines.push(`- Total: <code>${db.totalSessions}</code> | Aktif: <code>${db.activeSessions}</code>`);
  } else {
    lines.push(`- Status: <code>ERROR</code> — <code>${escapeHtml(db.error ?? '')}</code>`);
  }
  lines.push('', `<b>Gemini primary:</b> <code>${MODELS.flash25}</code>`);
  lines.push(`<b>Groq fallback:</b> <code>${GROQ_MODELS.versatile}</code>`);
  lines.push(`<b>Admin AI:</b> <code>${ADMIN_MODEL}</code>`);
  const poolInfo = groqPool.length === 0 ? 'tidak tersedia'
    : groqPool.length === 1 ? 'aktif (1 key)'
    : `aktif (${groqPool.length} key — ${groqPool.length}× kapasitas)`;
  lines.push(`<b>Groq Admin:</b> <code>${poolInfo}</code>`);

  return lines.join('\n');
}

// ─── Admin guard ───────────────────────────────────────────────────────────────
function adminGuard(ctx) {
  if (!isAdmin(ctx.from.id)) {
    ctx.answerCbQuery('⛔ Akses ditolak.').catch(() => {});
    return false;
  }
  return true;
}

// ─── Register all handlers ─────────────────────────────────────────────────────
function registerHandlers(bot) {

  // ── Commands ──────────────────────────────────────────────────────────────────
  bot.start(authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    const name      = ctx.from.first_name || 'bro';
    const adminFlag = isAdmin(ctx.from.id);
    await ctx.replyWithHTML(
      `Halo <b>${name}</b>! 👋\n\nAku siap membantu — langsung ketik saja. Konteks percakapanmu terdeteksi otomatis.\n\nGunakan tombol <b>⌨️ Perintah</b> di keyboard untuk navigasi.`,
      buildReplyMenu()
    );
    await ctx.replyWithHTML('Apa yang bisa aku bantu?', buildCommandPalette(session, adminFlag));
  });

  bot.command('menu', authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    const adminFlag = isAdmin(ctx.from.id);
    await ctx.reply('Perintah:', buildCommandPalette(session, adminFlag));
  });

  bot.command('new', authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    session.history = [];
    saveSession(ctx.chat.id);
    await ctx.reply('✅ Chat baru dimulai.');
  });

  bot.command('info', authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    const adminFlag = isAdmin(ctx.from.id);
    await ctx.replyWithHTML(buildInfoText(session), buildCommandPalette(session, adminFlag));
  });

  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('⛔ Akses ditolak.');
    const session     = getSession(ctx.chat.id);
    session.adminMode = true;
    saveSession(ctx.chat.id);
    await ctx.replyWithHTML(
      `<b>🔐 Admin Panel</b>\n\nMode admin aktif.\n\n<i>AI: ${ADMIN_MODEL}</i>`,
      adminMenu
    );
  });

  // ── Command Palette callbacks ──────────────────────────────────────────────────
  bot.action('show_palette', authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    const adminFlag = isAdmin(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply('Perintah:', buildCommandPalette(session, adminFlag));
  });

  bot.action('new_chat', authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    session.history = [];
    saveSession(ctx.chat.id);
    await ctx.answerCbQuery('✅ Chat baru dimulai');
    await ctx.reply('Chat baru dimulai. Silakan ketik pertanyaanmu.');
  });

  bot.action('clear_history', authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    session.history = [];
    saveSession(ctx.chat.id);
    await ctx.answerCbQuery('🗑️ History dihapus');
    await ctx.reply('History percakapan dihapus.');
  });

  bot.action('model_menu', authMiddleware, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Pilih model:', modelMenu);
  });

  bot.action('info', authMiddleware, async (ctx) => {
    const session   = getSession(ctx.chat.id);
    const adminFlag = isAdmin(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(buildInfoText(session), buildCommandPalette(session, adminFlag));
  });

  // ── Model actions ──────────────────────────────────────────────────────────────
  const MODEL_ACTIONS = [
    ['model_auto',           'auto',                '🔄 Auto aktif'],
    ['model_flash25',        MODELS.flash25,        '✨ Gemini Flash 2.5 aktif'],
    ['model_pro',            MODELS.pro,            '🧠 Gemini Pro 2.5 aktif'],
    ['model_flash',          MODELS.flash,          '🔥 Gemini Flash 2.0 aktif'],
    ['model_lite',           MODELS.lite,           '⚡ Gemini Lite aktif'],
    ['model_groq_instant',   GROQ_MODELS.instant,   '⚡ Llama 8B aktif'],
    ['model_groq_versatile', GROQ_MODELS.versatile, '🦙 Llama 70B aktif'],
    ['model_groq_qwen',      GROQ_MODELS.qwen,      '🐉 Qwen3 32B aktif'],
  ];
  for (const [action, modelKey, label] of MODEL_ACTIONS) {
    bot.action(action, authMiddleware, async (ctx) => {
      const session = getSession(ctx.chat.id);
      session.model = modelKey;
      saveSession(ctx.chat.id);
      await ctx.answerCbQuery(`✅ ${label}`);
      await ctx.replyWithHTML(
        `<b>${label}</b>`,
        buildCommandPalette(session, isAdmin(ctx.from.id))
      );
    });
  }

  // ── Admin callbacks ────────────────────────────────────────────────────────────
  bot.action('admin_panel', async (ctx) => {
    if (!adminGuard(ctx)) return;
    const session     = getSession(ctx.chat.id);
    session.adminMode = true;
    saveSession(ctx.chat.id);
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(
      `<b>🔐 Admin Panel</b>\n\nKetik pertanyaan atau pilih aksi:\n\n<i>AI: ${ADMIN_MODEL}</i>`,
      adminMenu
    );
  });

  bot.action('admin_exit', async (ctx) => {
    if (!adminGuard(ctx)) return;
    const session     = getSession(ctx.chat.id);
    session.adminMode = false;
    saveSession(ctx.chat.id);
    await ctx.answerCbQuery('✅ Keluar dari admin mode');
    await ctx.reply('Mode admin dinonaktifkan.', buildCommandPalette(session, true));
  });

  bot.action('admin_status', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    try {
      const txt = await buildStatusText();
      await ctx.replyWithHTML(txt, adminMiniMenu);
    } catch (err) {
      await ctx.replyWithHTML(`❌ Error: <code>${escapeHtml(err.message)}</code>`, adminMiniMenu);
    }
  });

  bot.action('admin_reset_all', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery();
    const count = [...sessions.values()].filter(v => v.history?.length > 0).length;
    for (const [, s] of sessions) s.history = [];
    saveSessions();
    await ctx.replyWithHTML(
      `<b>🧹 Reset Selesai</b>\n\n<code>${count}</code> session aktif dihapus.`,
      adminMiniMenu
    );
  });

  bot.action('admin_test', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery('🧪 Testing sanitizer...');
    const sample = [
      '**Bold markdown** dan __underline__',
      '<h2>Heading dua</h2>',
      '<ul><li>Item satu</li><li>Item dua</li></ul>',
      'if (a < b && c > d) { return true; }',
      '```js\nconst x = a < b ? \'less\' : \'more\';\n```',
      'Ini <b>bold valid</b> dan <code>kode inline</code>.',
    ].join('\n');
    const result = sanitizeForTelegram(sample);
    await ctx.replyWithHTML(
      '<b>🧪 Test Sanitizer</b>\n\n<b>Input:</b>\n<pre><code>' +
      escapeHtml(sample) + '</code></pre>\n\n<b>Output:</b>\n' + result,
      adminMiniMenu
    );
  });

  bot.action('admin_diagnose', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery('🔍 Membaca log...');
    await ctx.reply('🔍 Menganalisa runtime log... (~10-20 detik)');
    const typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);
    try {
      const result = await analyzeWithContext('Identifikasi error nyata, exception, atau anomali dari log ini. Hanya yang benar-benar ada di log.');
      clearInterval(typingInterval);
      console.log('[👑 Admin] Log diagnosa selesai');
      await sendLong(ctx, result, adminMiniMenu);
    } catch (err) {
      clearInterval(typingInterval);
      console.error('❌ [Admin Diagnose]:', err.message);
      await ctx.replyWithHTML(`❌ Error: <code>${escapeHtml(err.message?.slice(0, 120))}</code>`, adminMiniMenu);
    }
  });

  bot.action('admin_rawlog', async (ctx) => {
    if (!adminGuard(ctx)) return;
    await ctx.answerCbQuery('📜 Mengambil log...');
    try {
      const { source, logs } = await getPM2Logs(60);
      const header = `<b>📜 Log Mentah</b> <i>(sumber: ${source})</i>\n\n`;
      const body   = logs.length > 3800 ? logs.slice(-3800) : logs;
      await sendLong(ctx, header + '<pre><code>' + escapeHtml(body) + '</code></pre>', adminMiniMenu);
    } catch (err) {
      await ctx.replyWithHTML(`❌ Error: <code>${escapeHtml(err.message?.slice(0, 120))}</code>`, adminMiniMenu);
    }
  });

  // ── Handler: Text ─────────────────────────────────────────────────────────────
  bot.on('text', authMiddleware, async (ctx) => {
    const chatId    = ctx.chat.id;
    const userText  = ctx.message.text.trim();
    const session   = getSession(chatId);
    const adminFlag = isAdmin(ctx.from.id);

    // ── Reply Keyboard interceptor ─────────────────────────────────────────────
    switch (userText) {
      case REPLY_BTN.palette:
        await ctx.reply('Perintah:', buildCommandPalette(session, adminFlag));
        return;

      case REPLY_BTN.newChat:
        session.history = [];
        saveSession(chatId);
        await ctx.reply('✅ Chat baru dimulai. Silakan ketik pertanyaanmu.');
        return;
    }

    // ── Admin mode: route to code analyzer ────────────────────────────────────
    if (session.adminMode && adminFlag) {
      console.log(`\n[👑 ADMIN] ${ctx.from.first_name} (${chatId}): ${userText.slice(0, 80)}`);
      await ctx.sendChatAction('typing');
      const typingInterval = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);
      try {
        const result = await analyzeWithContext(userText);
        clearInterval(typingInterval);
        console.log(`[📤] [admin:${ADMIN_MODEL}] ${result.slice(0, 60).replace(/\n/g, ' ')}...`);
        await sendLong(ctx, result, {
          reply_parameters: { message_id: ctx.message.message_id },
          ...adminMiniMenu,
        });
      } catch (err) {
        clearInterval(typingInterval);
        console.error('❌ [Admin Chat]:', err.message);
        await ctx.replyWithHTML(
          `❌ Error: <code>${escapeHtml(err.message?.slice(0, 120))}</code>`,
          adminMiniMenu
        );
      }
      return;
    }

    // ── Normal chat flow ───────────────────────────────────────────────────────
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

  // ── Handler: Photo (Vision) ───────────────────────────────────────────────────
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

  // ── Handler: Document ─────────────────────────────────────────────────────────
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
        const fileParts = [{ inlineData: { mimeType: 'application/pdf', data: base64 } }];
        console.log('[Omni-Router] PDF detected -> Gemini only');
        result = await askWithGemini(chatId,
          caption || `Analisis dokumen PDF ini: ${doc.file_name}`,
          fileParts,
          [MODELS.flash25, MODELS.flash, MODELS.lite]
        );
      } else {
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
}

module.exports = { registerHandlers };
