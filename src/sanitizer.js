'use strict';

// Sanitize AI response → safe Telegram HTML
function sanitizeForTelegram(raw = '') {
  let text = raw;

  // 0. Strip Qwen3 <think>...</think> blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. Triple-backtick code blocks → <pre><code>
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    const safe = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre><code>${safe}</code></pre>`;
  });

  // 2. Inline backtick → <code>
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const safe = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<code>${safe}</code>`;
  });

  // 3. Markdown headings → <b>
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, c) => `<b>${c.trim()}</b>`);

  // 4. **bold** / __bold__ → <b> (sebelum italic, biar tidak bentrok)
  text = text.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');
  text = text.replace(/__(.+?)__/gs, '<b>$1</b>');

  // 5. *italic* → <i> — hati-hati: hanya single star, tidak di awal list item
  //    Underscore italic DIHAPUS — terlalu berbahaya untuk snake_case dan variabel teknikal
  text = text.replace(/(?<!\*)\*(?!\*)(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '<i>$1</i>');

  // 6. Markdown horizontal rule → hapus (jadi visual noise)
  text = text.replace(/^(-{3,}|_{3,}|\*{3,})$/gm, '');

  // 7. Blockquote > ... → strip prefix, biarkan teksnya
  text = text.replace(/^>\s?(.*)$/gm, '$1');

  // 8. Numbered list "1. Item" → "- Item" (normalize)
  text = text.replace(/^\d+\.\s+/gm, '- ');

  // 9. Protect valid Telegram HTML tags dengan placeholder
  const saved = [];
  const VALID  = /(<\/?(b|i|s|u|code|pre|a)(?:\s[^>]*)?>)/gi;
  text = text.replace(VALID, (match) => {
    saved.push(match);
    return `\x00${saved.length - 1}\x00`;
  });

  // 10. Convert illegal tags → plain text
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) =>
    '- ' + c.replace(/<[^>]*>/g, '').trim() + '\n'
  );
  text = text.replace(/<\/?(?:ul|ol)[^>]*>/gi, '');
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, c) =>
    '<b>' + c.replace(/<[^>]*>/g, '').trim() + '</b>\n'
  );
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n');
  text = text.replace(/<\/?(?:div|span|section|article|header|footer)[^>]*>/gi, '');
  text = text.replace(/<hr\s*\/?>/gi, '');

  // 11. Strip remaining unknown tags
  text = text.replace(/<[^>]+>/g, '');

  // 12. Escape bare & < > (bukan di dalam placeholder)
  text = text.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[\da-f]+;)/gi, '&amp;');
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');

  // 13. Restore valid tags
  text = text.replace(/\x00(\d+)\x00/g, (_, i) => saved[+i]);

  // 14. Collapse 3+ blank lines → 2
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
