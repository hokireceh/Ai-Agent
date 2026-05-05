'use strict';

const cron = require('node-cron');
const { buildDailyDigest, getSystemHealth, getDBHealth } = require('./admin');
const { ADMIN_USERS }                                     = require('./config');
const { escapeHtml, sendLong }                            = require('./sanitizer');

let _bot = null;

// ─── Init: panggil sekali dari index.js setelah bot dibuat ─────────────────────
function initScheduler(bot) {
  _bot = bot;

  // ── Daily Health Digest — setiap hari jam 07:00 WIB (UTC+7 = 00:00 UTC) ──────
  cron.schedule('0 0 * * *', async () => {
    console.log('[⏰ Scheduler] Daily digest dimulai...');
    if (!_bot || ADMIN_USERS.length === 0) return;

    try {
      const { summary, detailSaved } = await buildDailyDigest();
      const header = '<b>🌅 Daily Health Report</b>\n<i>Laporan otomatis jam 07:00 WIB</i>\n\n';
      const footer = detailSaved ? '\n\n<i>Detail teknis disimpan → audit.txt</i>' : '';

      for (const adminId of ADMIN_USERS) {
        try {
          await sendLong({ replyWithHTML: (t, e) => _bot.telegram.sendMessage(adminId, t, { parse_mode: 'HTML', ...e }) },
            header + summary + footer
          );
          console.log(`[⏰ Scheduler] Digest terkirim ke admin ${adminId}`);
        } catch (err) {
          console.error(`[⏰ Scheduler] Gagal kirim ke ${adminId}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[⏰ Scheduler] buildDailyDigest error:', err.message);
    }
  }, { timezone: 'Asia/Jakarta' });

  // ── Quick heartbeat check setiap jam — log ke console saja ───────────────────
  cron.schedule('0 * * * *', async () => {
    const h  = getSystemHealth();
    const db = await getDBHealth().catch(() => ({ status: 'ERROR' }));
    console.log(
      `[💓 Heartbeat] Heap: ${h.heapUsedMB}MB | RAM: ${h.ramUsedPct}% | ` +
      `Load: ${h.loadAvg1m} | DB: ${db.status}${db.latencyMs ? ` ${db.latencyMs}ms` : ''}`
    );

    // Kirim alert ke admin jika kondisi kritis
    if (_bot && ADMIN_USERS.length > 0) {
      const warnings = [];
      if (h.ramUsedPct > 90)                                  warnings.push(`⚠️ RAM kritis: ${h.ramUsedPct}%`);
      if (parseFloat(h.loadAvg1m) > h.cpuCount * 1.5)        warnings.push(`⚠️ CPU load tinggi: ${h.loadAvg1m}`);
      if (h.heapUsedMB > 400)                                 warnings.push(`⚠️ Heap besar: ${h.heapUsedMB}MB`);
      if (db.status === 'ERROR')                              warnings.push(`🔴 DB Error: ${db.error}`);
      else if (db.latencyMs > 2000)                           warnings.push(`🟡 DB lambat: ${db.latencyMs}ms`);

      if (warnings.length > 0) {
        const msg = `<b>🚨 Alert Otomatis</b>\n\n${warnings.join('\n')}`;
        for (const adminId of ADMIN_USERS) {
          _bot.telegram.sendMessage(adminId, msg, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    }
  });

  console.log('⏰ Scheduler aktif: Daily digest 07:00 WIB | Heartbeat setiap jam');
}

module.exports = { initScheduler };
