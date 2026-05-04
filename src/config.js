'use strict';

// ─── Environment ───────────────────────────────────────────────────────────────
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY     = process.env.GEMINI_API_KEY;
const GROQ_KEY       = process.env.GROQ_API_KEY;
const GROQ_ADMIN_KEY = process.env.GROQ_ADMIN_API_KEY || GROQ_KEY;

const ALLOWED_USERS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(',').map(Number)
  : [];

const ADMIN_USERS = process.env.ADMIN_USER_IDS
  ? process.env.ADMIN_USER_IDS.split(',').map(Number)
  : [];

if (!BOT_TOKEN || !GEMINI_KEY) {
  console.error('❌ TELEGRAM_BOT_TOKEN dan GEMINI_API_KEY wajib diisi di .env');
  process.exit(1);
}

// ─── Model Registry ────────────────────────────────────────────────────────────
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
  auto:                    '🔄 Auto',
  [MODELS.lite]:           '⚡ Flash Lite',
  [MODELS.flash]:          '🔥 Flash 2.0',
  [MODELS.flash25]:        '✨ Flash 2.5',
  [MODELS.pro]:            '🧠 Pro 2.5',
  [GROQ_MODELS.instant]:   '⚡ Llama 8B',
  [GROQ_MODELS.versatile]: '🦙 Llama 70B',
  [GROQ_MODELS.qwen]:      '🐉 Qwen3 32B',
};

const MODEL_SHORT = {
  auto:                    'Auto',
  [MODELS.lite]:           'Lite',
  [MODELS.flash]:          'Flash 2.0',
  [MODELS.flash25]:        'Flash 2.5',
  [MODELS.pro]:            'Pro 2.5',
  [GROQ_MODELS.instant]:   'Llama 8B',
  [GROQ_MODELS.versatile]: 'Llama 70B',
  [GROQ_MODELS.qwen]:      'Qwen3 32B',
};

module.exports = {
  BOT_TOKEN,
  GEMINI_KEY,
  GROQ_KEY,
  GROQ_ADMIN_KEY,
  ALLOWED_USERS,
  ADMIN_USERS,
  MODELS,
  GROQ_MODELS,
  MODEL_LABELS,
  MODEL_SHORT,
};
