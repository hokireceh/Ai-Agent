'use strict';

const { Markup } = require('telegraf');
const { MODEL_SHORT, MODELS, GROQ_MODELS } = require('./config');

const MODE_EMOJI = { general: '💡', coding: '🧠', analyst: '📊', creative: '🎨' };

function buildMainMenu(session, isAdmin = false) {
  const modeLabel  = `${MODE_EMOJI[session?.mode] ?? '💡'} ${(session?.mode ?? 'general').charAt(0).toUpperCase() + (session?.mode ?? 'general').slice(1)}`;
  const modelLabel = `🤖 ${MODEL_SHORT[session?.model] ?? 'Auto'}`;
  const rows = [
    [Markup.button.callback('💬 Chat Baru', 'new_chat'), Markup.button.callback('🗑️ Hapus History', 'clear_history')],
    [Markup.button.callback(`⚙️ Mode: ${modeLabel}`, 'mode_menu'), Markup.button.callback(modelLabel, 'model_menu')],
    [Markup.button.callback('ℹ️ Info', 'info')],
  ];
  if (isAdmin) rows.push([Markup.button.callback('🔐 Admin Panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
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

const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🔍 Deep Audit', 'admin_diagnose'), Markup.button.callback('📋 Full Audit', 'admin_audit')],
  [Markup.button.callback('📊 System Status', 'admin_status'), Markup.button.callback('🧹 Reset Semua Session', 'admin_reset_all')],
  [Markup.button.callback('🧪 Test Sanitizer', 'admin_test'), Markup.button.callback('❌ Keluar Admin', 'admin_exit')],
]);

const adminMiniMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🔍 Deep Audit', 'admin_diagnose'), Markup.button.callback('📋 Full Audit', 'admin_audit')],
  [Markup.button.callback('🏠 Admin Panel', 'admin_panel'), Markup.button.callback('❌ Keluar', 'admin_exit')],
]);

module.exports = {
  MODE_EMOJI,
  buildMainMenu,
  modeMenu,
  modelMenu,
  miniMenu,
  adminMenu,
  adminMiniMenu,
};
