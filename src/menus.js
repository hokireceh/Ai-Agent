'use strict';

const { Markup } = require('telegraf');
const { MODEL_SHORT, MODELS, GROQ_MODELS } = require('./config');

// ─── Reply Keyboard: persisten, minimalis ──────────────────────────────────────
const REPLY_BTN = {
  palette: '⌨️ Perintah',
  newChat: '💬 Chat Baru',
};

function buildReplyMenu() {
  return Markup.keyboard([
    [REPLY_BTN.palette, REPLY_BTN.newChat],
  ]).resize();
}

// ─── Command Palette: inline keyboard terstruktur ─────────────────────────────
function buildCommandPalette(session, isAdmin = false) {
  const modelLabel = MODEL_SHORT[session?.model] ?? 'Auto';
  const rows = [
    [
      Markup.button.callback('💬 Chat Baru',      'new_chat'),
      Markup.button.callback('🗑️ Hapus History',  'clear_history'),
    ],
    [
      Markup.button.callback(`🤖 Model: ${modelLabel}`, 'model_menu'),
    ],
    [
      Markup.button.callback('ℹ️ Info Bot', 'info'),
    ],
  ];
  if (isAdmin) {
    rows.push([Markup.button.callback('🔐 Admin Panel', 'admin_panel')]);
  }
  return Markup.inlineKeyboard(rows);
}

// ─── Model selection menu ──────────────────────────────────────────────────────
const modelMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🔄 Auto (Recommended)', 'model_auto')],
  [Markup.button.callback('✨ Gemini Flash 2.5', 'model_flash25'), Markup.button.callback('🧠 Gemini Pro 2.5', 'model_pro')],
  [Markup.button.callback('🔥 Gemini Flash 2.0', 'model_flash'),  Markup.button.callback('⚡ Gemini Lite',    'model_lite')],
  [Markup.button.callback('⚡ Llama 8B (Groq)', 'model_groq_instant'), Markup.button.callback('🦙 Llama 70B (Groq)', 'model_groq_versatile')],
  [Markup.button.callback('🐉 Qwen3 32B (Groq)', 'model_groq_qwen')],
  [Markup.button.callback('« Kembali', 'show_palette')],
]);

// ─── Mini menu setelah respons AI ─────────────────────────────────────────────
const miniMenu = Markup.inlineKeyboard([
  [Markup.button.callback('⌨️ Perintah', 'show_palette'), Markup.button.callback('💬 Chat Baru', 'new_chat')],
]);

// ─── Admin menus ──────────────────────────────────────────────────────────────
const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🔍 Log Diagnosa', 'admin_diagnose'), Markup.button.callback('📜 Log Mentah', 'admin_rawlog')],
  [Markup.button.callback('📊 System Status', 'admin_status'),  Markup.button.callback('🧹 Reset Semua', 'admin_reset_all')],
  [Markup.button.callback('🧪 Test Sanitizer', 'admin_test'),   Markup.button.callback('❌ Keluar Admin', 'admin_exit')],
]);

const adminMiniMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🔍 Log Diagnosa', 'admin_diagnose'), Markup.button.callback('📜 Log Mentah', 'admin_rawlog')],
  [Markup.button.callback('🏠 Admin Panel',  'admin_panel'),    Markup.button.callback('❌ Keluar',     'admin_exit')],
]);

module.exports = {
  REPLY_BTN,
  buildReplyMenu,
  buildCommandPalette,
  modelMenu,
  miniMenu,
  adminMenu,
  adminMiniMenu,
};
