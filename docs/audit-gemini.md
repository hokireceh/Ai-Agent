# Audit Engine — Gemini API

> Dokumen ini mencatat temuan spesifik terkait Google Gemini API, SDK behavior, dan known issues.
> Source: https://ai.google.dev/gemini-api/docs

---

## SDK Info

| Item         | Value                                   |
|--------------|-----------------------------------------|
| Package      | `@google/generative-ai`                 |
| Version      | `0.21.0`                                |
| API Endpoint | `https://generativelanguage.googleapis.com/v1beta` |
| Auth         | API Key via `GoogleGenerativeAI(key)`   |

---

## Known Issues & Fixes

### ❌ Issue #004: `gemini-2.5-pro-preview-05-06` → 404 pada free tier API key (FIXED)
- **Status:** Model ada tapi butuh billing / akses khusus (bukan free tier biasa)
- **Error:** 404 Not Found
- **Fix:** Hapus dari auto-cascade. Tetap tersedia sebagai opsi manual di model menu, tapi user harus sadari ini butuh billing.
- **Tier 3 cascade diupdate:** `[flash25 → flash → lite]` (Pro dikeluarkan dari auto)

### ❌ Issue #005: Gemini Flash 2.5 generate `<ul>`, `<li>` → invalid di Telegram (FIXED)
- **Root cause:** System prompt hanya menyebut "dilarang tabel" — model tetap generate HTML list yang valid secara HTML tapi tidak didukung Telegram
- **Symptom:** Response tampil dengan tag `<ul>` dan `<li>` sebagai teks mentah di chat
- **Fix:** Perkuat framing di system prompt:
  - Dari: "Format WAJIB HTML Telegram, dilarang markdown"
  - Ke: "Tag HTML yang BOLEH dipakai (hanya ini yang valid di Telegram)"
  - Tambahkan daftar eksplisit yang DILARANG: `<ul>`, `<ol>`, `<li>`, `<h1>`-`<h6>`, `<br>`, `<hr>`
- **Catatan:** Framing positif ("yang boleh") + daftar negatif eksplisit lebih efektif daripada hanya framing negatif

### ❌ Issue #001: `gemini-1.5-flash` → 404 Not Found (FIXED)
- **Status:** Deprecated di endpoint v1beta per Mei 2026
- **Error:** `models/gemini-1.5-flash is not found for API version v1beta`
- **Fix:** Ganti ke `gemini-2.0-flash`
- **Source:** Error message resmi dari API response

### ⚠️ Issue #002: `systemInstruction` harus string atau object
- **Detail:** `getGenerativeModel({ systemInstruction: "..." })` — pastikan value berupa string
- Jika undefined atau null, SDK mungkin throw silently

### ⚠️ Issue #003: `history` format sangat strict
- **Format wajib:** `{ role: 'user' | 'model', parts: [{ text: string }] }`
- `role: 'assistant'` **tidak valid** — akan throw error
- History harus alternating user/model — jangan push 2 user berturut-turut

### ⚠️ Issue #004: `sendMessage` dengan array parts (multimodal)
- Untuk gambar + teks: `chat.sendMessage([{ inlineData: {...} }, { text: "..." }])`
- `inlineData.data` harus base64 string **tanpa** prefix `data:image/jpeg;base64,`
- `inlineData.mimeType` harus tepat: `image/jpeg`, `image/png`, `application/pdf`

### ⚠️ Issue #005: Rate limits free tier (Mei 2026)
| Model                          | RPM  | TPM         |
|--------------------------------|------|-------------|
| `gemini-2.0-flash-lite`        | 30   | 1,000,000   |
| `gemini-2.0-flash`             | 60   | 1,000,000   |
| `gemini-2.5-pro-preview-05-06` | 2    | 1,000,000   |

- RPM = Requests Per Minute
- Jika limit tercapai → HTTP 429, trigger cascade ke model berikutnya

---

## Chat Session Behavior

```
genAI.getGenerativeModel({ model, systemInstruction })
    └── model.startChat({ history: [...] })
            └── chat.sendMessage(parts)
                    └── result.response.text()
```

- `startChat({ history })` menerima history TANPA pesan terakhir (user)
- `sendMessage(parts)` mengirim pesan user baru
- Response diambil via `result.response.text()`
- History harus disimpan manual — SDK tidak persist history

---

## Model Capability Matrix

| Feature                | Flash Lite | Flash | Pro   |
|------------------------|------------|-------|-------|
| Text generation        | ✅          | ✅    | ✅    |
| Image understanding    | ✅          | ✅    | ✅    |
| PDF understanding      | ✅          | ✅    | ✅    |
| Long context (1M token)| ✅          | ✅    | ✅    |
| Complex reasoning      | ❌          | ⭐⭐  | ⭐⭐⭐⭐|
| Code generation        | ⭐          | ⭐⭐⭐ | ⭐⭐⭐⭐|
| System instruction     | ✅          | ✅    | ✅    |

---

## Cara Verifikasi Model Aktif

Gunakan ListModels untuk mendapatkan daftar model yang tersedia di API key kamu:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_API_KEY" | jq '.models[].name'
```

Atau via Node.js:
```javascript
const { GoogleGenerativeAI } = require('@google/generative-ai');
// SDK v0.21.0 belum expose listModels — gunakan curl di atas
```

---

## Changelog

| Tanggal    | Temuan                                                              |
|------------|---------------------------------------------------------------------|
| 2026-05-04 | Issue #001: `gemini-1.5-flash` deprecated. Fix applied. Issue #003-005 documented. |
