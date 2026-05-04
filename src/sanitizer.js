'use strict';

// Sanitize AI response → safe Telegram HTML
// Pipeline: markdown → illegal-tag conversion → strip → escape bare angles → restore valid tags
function sanitizeForTelegram(raw = '') {
  let text = raw;

  // 1. Markdown triple-backtick → <pre><code> (escape content inside)
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const safe = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre><code>${safe}</code></pre>`;
  });

  // 2. Inline backtick → <code> (escape content inside)
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const safe = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<code>${safe}</code>`;
  });

  // 3. Protect valid Telegram tags with placeholders
  const saved = [];
  const VALID = /(<\/?(b|i|s|u|code|pre|a)(?:\s[^>]*)?>)/gi;
  text = text.replace(VALID, (match) => {
    saved.push(match);
    return `\x00${saved.length - 1}\x00`;
  });

  // 4. Convert illegal tags to plain-text equivalents
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) =>
    '- ' + c.replace(/<[^>]*>/g, '').trim() + '\n'
  );
  text = text.replace(/<\/?(?:ul|ol)[^>]*>/gi, '');
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, c) =>
    c.replace(/<[^>]*>/g, '').trim() + '\n'
  );

  // 5. Strip any remaining unknown tags
  text = text.replace(/<[^>]+>/g, '');

  // 6. Escape bare & < > that survived (not inside placeholders)
  text = text.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[\da-f]+;)/gi, '&amp;');
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');

  // 7. Restore valid tags
  text = text.replace(/\x00(\d+)\x00/g, (_, i) => saved[+i]);

  // 8. Collapse 3+ consecutive blank lines → 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function escapeHtml(text = '') {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function downloadAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download gagal: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

async function sendLong(ctx, raw, extra = {}) {
  const text = sanitizeForTelegram(raw);
  const MAX  = 4000;

  if (text.length <= MAX) {
    try { return await ctx.replyWithHTML(text, extra); }
    catch { return await ctx.reply(text, extra); }
  }

  const lines  = text.split('\n');
  const chunks = [];
  let current  = '';

  for (const line of lines) {
    if ((current + line).length > MAX) {
      if (current.trim()) chunks.push(current.trim());
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.trim()) chunks.push(current.trim());

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    try { await ctx.replyWithHTML(chunks[i], isLast ? extra : {}); }
    catch { await ctx.reply(chunks[i], isLast ? extra : {}); }
  }
}

module.exports = { sanitizeForTelegram, escapeHtml, downloadAsBase64, sendLong };
