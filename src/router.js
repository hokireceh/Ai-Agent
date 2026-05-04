'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

const { GEMINI_KEY, GROQ_KEY, MODELS, GROQ_MODELS } = require('./config');
const { SYSTEM_PROMPTS } = require('./prompts');
const { getSession, saveSession } = require('./utils/session');

const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const groq  = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY }) : null;

// ─── Complexity Detector ───────────────────────────────────────────────────────
function isComplex(text) {
  const words   = text.split(/\s+/).length;
  const hasCode = /```|function |class |import |const |def |async |await |SELECT |CREATE /.test(text);
  const isDeep  = /\banalisis\b|\bjelaskan detail\b|\bbandingkan\b|\bevaluasi\b|\brancang\b|\barsitektur\b|\boptimasi\b|\bstrategi\b/i.test(text);
  return hasCode || isDeep || words > 80;
}

// ─── History Converter: Gemini → Groq (OpenAI format) ─────────────────────────
function historyToGroq(history, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const msg of history.slice(-30)) {
    const textParts = msg.parts.filter(p => p.text);
    const hasMedia  = msg.parts.some(p => p.inlineData);
    const content   = textParts.map(p => p.text).join('')
                    + (hasMedia ? '\n[Pengguna mengirim gambar/file]' : '');
    messages.push({
      role:    msg.role === 'model' ? 'assistant' : 'user',
      content: content || '[...]',
    });
  }
  return messages;
}

// ─── Gemini Ask ────────────────────────────────────────────────────────────────
async function askWithGemini(chatId, userMessage, imageParts = [], modelCascade = []) {
  const session      = getSession(chatId);
  const systemPrompt = SYSTEM_PROMPTS[session.mode] || SYSTEM_PROMPTS.general;
  const msgParts     = imageParts.length > 0
    ? [...imageParts, { text: userMessage || 'Analisis konten ini.' }]
    : userMessage;

  let lastErr;
  for (const modelId of modelCascade) {
    try {
      const model  = genAI.getGenerativeModel({ model: modelId, systemInstruction: systemPrompt });
      const chat   = model.startChat({ history: session.history.slice(-30) });
      const result = await chat.sendMessage(msgParts);
      const text   = result.response.text();

      const userPart = imageParts.length > 0
        ? { role: 'user', parts: [...imageParts, { text: userMessage || 'Analisis konten ini.' }] }
        : { role: 'user', parts: [{ text: userMessage }] };
      session.history.push(userPart);
      session.history.push({ role: 'model', parts: [{ text }] });
      if (session.history.length > 40) session.history = session.history.slice(-40);
      saveSession(chatId);

      return { text, usedModel: modelId, provider: 'gemini' };

    } catch (err) {
      lastErr = err;
      const isFallbackable = err.status === 429 || err.status === 404 || err.status === 503
        || err.message?.includes('quota')
        || err.message?.includes('not found')
        || err.message?.includes('overloaded');

      const nextIdx = modelCascade.indexOf(modelId) + 1;
      if (isFallbackable && nextIdx < modelCascade.length) {
        console.warn(`[Omni-Router] Gemini ${modelId} failed (${err.status ?? err.message?.slice(0, 40)}), trying ${modelCascade[nextIdx]}...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── Groq Ask ─────────────────────────────────────────────────────────────────
async function askWithGroq(chatId, userMessage, modelId) {
  const session      = getSession(chatId);
  const systemPrompt = SYSTEM_PROMPTS[session.mode] || SYSTEM_PROMPTS.general;
  const messages     = historyToGroq(session.history, systemPrompt);
  messages.push({ role: 'user', content: userMessage });

  const completion = await groq.chat.completions.create({
    model:       modelId,
    messages,
    temperature: 0.7,
    max_tokens:  4096,
  });

  const text = completion.choices[0]?.message?.content || '';

  session.history.push({ role: 'user',  parts: [{ text: userMessage }] });
  session.history.push({ role: 'model', parts: [{ text }] });
  if (session.history.length > 40) session.history = session.history.slice(-40);
  saveSession(chatId);

  return { text, usedModel: modelId, provider: 'groq' };
}

// ─── Groq Tier 4 Fallback Chain ───────────────────────────────────────────────
async function groqFallback(chatId, userMessage) {
  try {
    console.log(`[Omni-Router] Tier 4: Groq Versatile (${GROQ_MODELS.versatile})`);
    return await askWithGroq(chatId, userMessage, GROQ_MODELS.versatile);
  } catch {
    console.warn('[Omni-Router] Tier 4 Versatile failed, trying Qwen...');
    return await askWithGroq(chatId, userMessage, GROQ_MODELS.qwen);
  }
}

// ─── Omni-Router: smartRequest ────────────────────────────────────────────────
async function smartRequest(chatId, userMessage, imageParts = []) {
  const session = getSession(chatId);
  const groqOK  = !!groq;
  const msgLen  = userMessage.length;
  const coding  = session.mode === 'coding';
  const complex = isComplex(userMessage);

  // Multimodal → always Gemini (Groq free tier: text only)
  if (imageParts.length > 0) {
    console.log('[Omni-Router] Multimodal detected -> Gemini only');
    return askWithGemini(chatId, userMessage, imageParts,
      [MODELS.flash25, MODELS.flash, MODELS.lite]);
  }

  // User-chosen model (not auto)
  if (session.model !== 'auto') {
    const isGroqModel = Object.values(GROQ_MODELS).includes(session.model);

    if (isGroqModel && groqOK) {
      console.log(`[Omni-Router] User model (Groq) -> ${session.model}`);
      return askWithGroq(chatId, userMessage, session.model);
    }

    const geminiCascade = [session.model, MODELS.flash25, MODELS.flash, MODELS.lite]
      .filter((v, i, a) => a.indexOf(v) === i);
    try {
      return await askWithGemini(chatId, userMessage, [], geminiCascade);
    } catch (err) {
      const isQuota = err.status === 429 || err.message?.includes('quota');
      if (isQuota && groqOK) {
        console.log('[Omni-Router] User model quota hit -> Tier 4 Groq fallback');
        return groqFallback(chatId, userMessage);
      }
      throw err;
    }
  }

  // Tier 1 — Short/instant → Groq Llama 8B
  if (groqOK && msgLen < 40) {
    console.log(`[Omni-Router] Short query (${msgLen} chars) -> Tier 1: Llama 8B (Groq)`);
    try {
      return await askWithGroq(chatId, userMessage, GROQ_MODELS.instant);
    } catch {
      console.warn('[Omni-Router] Tier 1 failed, cascading to Tier 2...');
    }
  }

  // Tier 3 — Coding mode or complex query
  if (coding || complex) {
    console.log(`[Omni-Router] ${coding ? 'Coding mode' : 'Complex query'} -> Tier 3: Gemini Flash 2.5`);
    try {
      return await askWithGemini(chatId, userMessage, [],
        [MODELS.flash25, MODELS.flash, MODELS.lite]);
    } catch (err) {
      const isQuota = err.status === 429 || err.message?.includes('quota');
      if (isQuota && groqOK) {
        console.log('[Omni-Router] Gemini quota -> Tier 4: Groq Versatile');
        return groqFallback(chatId, userMessage);
      }
      throw err;
    }
  }

  // Tier 2 — General → Gemini Flash 2.5
  console.log('[Omni-Router] General query -> Tier 2: Gemini Flash 2.5');
  try {
    return await askWithGemini(chatId, userMessage, [],
      [MODELS.flash25, MODELS.flash, MODELS.lite]);
  } catch (err) {
    const isQuota = err.status === 429 || err.message?.includes('quota');
    if (isQuota && groqOK) {
      console.log('[Omni-Router] Gemini Flash quota -> Tier 4: Groq Versatile');
      return groqFallback(chatId, userMessage);
    }
    throw err;
  }
}

module.exports = { genAI, groq, smartRequest, askWithGemini };
