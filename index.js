require('dotenv').config();
const { Telegraf } = require('telegraf');

const { BOT_TOKEN, MODELS, GROQ_MODELS, GROQ_ALL_KEYS } = require('./src/config');
const { groq }                                          = require('./src/router');
const { initSessions, saveSessions }     = require('./src/utils/session');
const { registerHandlers }               = require('./src/handlers');
const { initScheduler }                  = require('./src/scheduler');

(async () => {
  await initSessions();

  const bot = new Telegraf(BOT_TOKEN);
  registerHandlers(bot);
  initScheduler(bot);

  bot.launch({ dropPendingUpdates: true });

  console.log('🤖 Bot aktif — Mode: Polling | Storage: NeonDB');
  console.log(`📦 Gemini: ${MODELS.flash25} | ${MODELS.pro} | ${MODELS.flash} | ${MODELS.lite}`);
  const groqKeys = GROQ_ALL_KEYS.length;
  console.log(`📦 Groq  : ${groqKeys > 0 ? `${GROQ_MODELS.instant} | ${GROQ_MODELS.versatile} | ${GROQ_MODELS.qwen} [${groqKeys} key${groqKeys > 1 ? ` — ${groqKeys}× TPM` : ''}]` : 'DISABLED (no GROQ_API_KEY)'}`);
  const surfKey = process.env.SURF_API_KEY;
  console.log(`🌊 Surf  : ${surfKey ? 'ENABLED — live crypto data injection aktif' : 'DISABLED (no SURF_API_KEY)'}`);

  process.once('SIGINT',  () => { saveSessions(); bot.stop('SIGINT'); });
  process.once('SIGTERM', () => { saveSessions(); bot.stop('SIGTERM'); });
})();
