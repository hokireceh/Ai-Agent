'use strict';

const { execFile } = require('child_process');

const MAX_OUTPUT = 3500; // chars — biar muat di Telegram
const TIMEOUT_MS = 15000; // 15 detik max

/**
 * Jalankan shell command, return { stdout, stderr, code, timedOut }
 * Dieksekusi via /bin/sh -c untuk support pipe, &&, dll
 */
function runShell(command) {
  return new Promise((resolve) => {
    const child = execFile(
      '/bin/sh',
      ['-c', command],
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 512 },
      (err, stdout, stderr) => {
        const timedOut = err?.killed || err?.code === 'ETIMEDOUT';
        resolve({
          stdout:  stdout?.trim() || '',
          stderr:  stderr?.trim() || '',
          code:    err ? (err.code ?? 1) : 0,
          timedOut,
        });
      }
    );

    // Fallback kill jika timeout tidak otomatis
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, TIMEOUT_MS + 500);
  });
}

/**
 * Format output shell untuk Telegram HTML
 */
function formatShellOutput({ stdout, stderr, code, timedOut, command }) {
  const lines = [`<b>$ ${command}</b>`];

  if (timedOut) {
    lines.push('⏱️ <i>Timeout (15s)</i>');
  }

  const out = stdout || '';
  const err = stderr || '';
  const combined = [out, err].filter(Boolean).join('\n');

  if (combined) {
    const truncated = combined.length > MAX_OUTPUT
      ? combined.slice(0, MAX_OUTPUT) + '\n… <i>(output dipotong)</i>'
      : combined;
    lines.push(`<pre><code>${truncated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
  } else if (!timedOut) {
    lines.push('<i>(tidak ada output)</i>');
  }

  lines.push(`<i>Exit code: ${code}</i>`);
  return lines.join('\n');
}

module.exports = { runShell, formatShellOutput };
