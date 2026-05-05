'use strict';

const cron = require('node-cron');
const { getSystemHealth, getDBHealth } = require('./admin');
const { ADMIN_USERS }                  = require('./config');

let _bot = null;

function initScheduler(bot) {
  _bot = bot;

  // ── Heartbeat setiap jam — log + alert kritis ke admin ────────────────────────
  cron.schedule('0 * * * *', async () => {
    const h  = getSystemHealth();
    const db = await getDBHealth().catch(() => ({ status: 'ERROR' }));
    console.log(
      `[💓 Heartbeat] Heap: ${h.heapUsedMB}MB | RAM: ${h.ramUsedPct}% | ` +
      `Load: ${h.loadAvg1m} | DB: ${db.status}${db.latencyMs ? ` ${db.latencyMs}ms` : ''}`
    );

    if (!_bot || ADMIN_USERS.length === 0) return;

    const warnings = [];
    if (h.ramUsedPct > 90)                             warnings.push(`⚠️ RAM kritis: ${h.ramUsedPct}%`);
    if (parseFloat(h.loadAvg1m) > h.cpuCount * 1.5)   warnings.push(`⚠️ CPU load tinggi: ${h.loadAvg1m}`);
    if (h.heapUsedMB > 400)                            warnings.push(`⚠️ Heap besar: ${h.heapUsedMB}MB`);
    if (db.status === 'ERROR')                         warnings.push(`🔴 DB Error: ${db.error}`);
    else if (db.latencyMs > 2000)                      warnings.push(`🟡 DB lambat: ${db.latencyMs}ms`);

    if (warnings.length > 0) {
      const msg = `<b>🚨 Alert Otomatis</b>\n\n${warnings.join('\n')}`;
      for (const adminId of ADMIN_USERS) {
        _bot.telegram.sendMessage(adminId, msg, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  });

  console.log('⏰ Scheduler aktif: Heartbeat setiap jam');
}

module.exports = { initScheduler };
