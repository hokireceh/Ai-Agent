'use strict';

// Sanitize AI response → safe Telegram HTML
// Pipeline: strip think blocks → markdown → illegal-tag conversion → strip → escape → restore valid tags
function sanitizeForTelegram(raw = '') {
  let text = raw;

  // 0. Strip Qwen3 <think>...</think> reasoning blocks (always hidden from user)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

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

  // 3. Markdown headings → <b> (##, ###, #### → bold)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, content) => `<b>${content.trim()}</b>`);

  // 4. Markdown bold **text** or __text__ → <b>
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // 5. Markdown italic *text* or _text_ → <i> (single star/underscore, not double)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<i>$1</i>');

  // 6. Protect valid Telegram tags with placeholders
  const saved = [];
  const VALID = /(<\/?(b|i|s|u|code|pre|a)(?:\s[^>]*)?>)/gi;
  text = text.replace(VALID, (match) => {
    saved.push(match);
    return `\x00${saved.length - 1}\x00`;
  });

  // 7. Convert illegal HTML tags to plain-text equivalents
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) =>
    '- ' + c.replace(/<[^>]*>/g, '').trim() + '\n'
  );
  text = text.replace(/<\/?(?:ul|ol)[^>]*>/gi, '');
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, c) =>
    '<b>' + c.replace(/<[^>]*>/g, '').trim() + '</b>\n'
  );

  // 8. Strip any remaining unknown tags
  text = text.replace(/<[^>]+>/g, '');

  // 9. Escape bare & < > that survived (not inside placeholders)
  text = text.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[\da-f]+;)/gi, '&amp;');
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');

  // 10. Restore valid tags
  text = text.replace(/\x00(\d+)\x00/g, (_, i) => saved[+i]);

  // 11. Collapse 3+ consecutive blank lines → 2
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
