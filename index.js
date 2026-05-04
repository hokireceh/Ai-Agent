require('dotenv').config();
const { Telegraf } = require('telegraf');

const { BOT_TOKEN, MODELS, GROQ_MODELS } = require('./src/config');
const { groq }              = require('./src/router');
const { saveSessions }      = require('./src/session');
const { registerHandlers }  = require('./src/handlers');

const bot = new Telegraf(BOT_TOKEN);
registerHandlers(bot);

bot.launch({ dropPendingUpdates: true });

console.log('🤖 Bot aktif — Mode: Polling | Session: Persistent File');
console.log(`📦 Gemini: ${MODELS.flash25} | ${MODELS.pro} | ${MODELS.flash} | ${MODELS.lite}`);
console.log(`📦 Groq  : ${groq ? `${GROQ_MODELS.instant} | ${GROQ_MODELS.versatile} | ${GROQ_MODELS.qwen}` : 'DISABLED (no GROQ_API_KEY)'}`);

process.once('SIGINT',  () => { saveSessions(); bot.stop('SIGINT'); });
process.once('SIGTERM', () => { saveSessions(); bot.stop('SIGTERM'); });
