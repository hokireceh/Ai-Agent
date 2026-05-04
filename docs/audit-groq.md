# Audit Engine — Groq API

> Source: https://console.groq.com/docs/models
> Live API check: `GET https://api.groq.com/openai/v1/models`
> Terakhir diverifikasi: Mei 2026 (live API call — bukan asumsi)

---

## SDK Info

| Item         | Value                                 |
|--------------|---------------------------------------|
| Package      | `groq-sdk`                            |
| API Format   | OpenAI-compatible (`/v1/chat/completions`) |
| Auth         | `GROQ_API_KEY` via env var            |
| Init         | `new Groq({ apiKey: process.env.GROQ_API_KEY })` |

---

## Model Registry (verified dari live API)

| Alias      | Model ID                  | RPM | RPD    | Token Limit | Use Case           |
|------------|---------------------------|-----|--------|-------------|---------------------|
| `instant`  | `llama-3.1-8b-instant`    | 30  | 14,400 | 8,192       | Tier 1: Short/instant queries |
| `versatile`| `llama-3.3-70b-versatile` | 30  | 1,000  | 32,768      | Tier 4: Heavy fallback        |
| `qwen`     | `qwen/qwen3-32b`          | 60  | —      | 32,768      | Tier 4: Qwen fallback         |

> ⚠️ **`qwen-2.5-32b` TIDAK ADA** di Groq API. Model yang benar adalah `qwen/qwen3-32b`.
> Jika dokumentasi lain menyebut `qwen-2.5-32b`, itu salah — selalu verifikasi ke live API.

---

## Request Format (OpenAI-compatible)

```javascript
const completion = await groq.chat.completions.create({
  model: 'llama-3.1-8b-instant',
  messages: [
    { role: 'system',    content: systemPrompt },
    { role: 'user',      content: 'pesan user' },
    { role: 'assistant', content: 'jawaban sebelumnya' },
    // ...history
  ],
  temperature: 0.7,
  max_tokens:  4096,
});
const text = completion.choices[0].message.content;
```

### Perbedaan dengan Gemini
| Aspek         | Gemini SDK                              | Groq SDK                            |
|---------------|----------------------------------------|--------------------------------------|
| Role model    | `role: 'model'`                        | `role: 'assistant'`                  |
| History format| `{ parts: [{ text }] }`               | `{ content: string }`                |
| System prompt | `systemInstruction` di `getGenerativeModel` | Entry pertama dengan `role: 'system'` |
| Multimodal    | ✅ Didukung (inlineData)               | ❌ Tidak didukung (text only)        |
| Streaming     | Optional                               | Optional                             |

---

## History Conversion: Gemini → Groq

Semua history disimpan dalam format Gemini (single source of truth).
Konversi dilakukan on-the-fly saat memanggil Groq:

```javascript
function historyToGroq(history, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const msg of history.slice(-20)) {
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
```

---

## Batasan Groq (Free Tier)

- **Tidak ada support binary file** (gambar, PDF) — text only
- Karena itu: `imageParts.length > 0` → SELALU route ke Gemini, bukan Groq
- Rate limit `llama-3.3-70b-versatile`: hanya 1000 RPD — gunakan hanya sebagai fallback
- Rate limit `llama-3.1-8b-instant`: 14,400 RPD — aman untuk Tier 1

---

## Graceful Degradation

Jika `GROQ_API_KEY` tidak diset:
- `const groq = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY }) : null`
- Semua Groq tier diskip otomatis
- Bot tetap berjalan dengan Gemini-only cascade

---

## Changelog

| Tanggal    | Temuan                                                                        |
|------------|-------------------------------------------------------------------------------|
| 2026-05-04 | Initial audit. Verified model IDs via live API. Noted: `qwen-2.5-32b` tidak ada, diganti `qwen/qwen3-32b`. Integrated ke Omni-Router cascade. |
