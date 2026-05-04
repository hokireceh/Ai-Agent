# Prompt Audit — Telegram Omni-Router Bot

> Dokumen referensi utama. Semua keputusan terkait model, prompt, routing, dan arsitektur harus mengacu ke sini.
> Update dokumen ini setiap kali ada perubahan model, prompt, atau aturan format.

---

## 1. Model Registry

### Gemini (source: ai.google.dev/gemini-api/docs/models — verified May 2026)

> SDK: `@google/generative-ai@0.21.0` — endpoint `v1beta`

| Alias     | Model ID                         | Speed      | Quality     | Free Tier          | Role dalam Cascade  |
|-----------|----------------------------------|------------|-------------|--------------------|--------------------|
| `lite`    | `gemini-2.0-flash-lite`          | ⚡⚡⚡      | ⭐⭐        | ✅ Ya (30 RPM)     | Safety net terakhir |
| `flash`   | `gemini-2.0-flash`               | ⚡⚡        | ⭐⭐⭐      | ✅ Ya (60 RPM)     | Fallback Tier 2/3   |
| `flash25` | `gemini-2.5-flash`               | ⚡⚡        | ⭐⭐⭐⭐    | ✅ Ya              | Tier 2: General     |
| `pro`     | `gemini-2.5-pro-preview-05-06`   | ⚡          | ⭐⭐⭐⭐⭐  | ✅ Terbatas (2 RPM)| Tier 3: Coding/Complex |

### Groq (source: live API call `GET api.groq.com/openai/v1/models` — May 2026)

> SDK: `groq-sdk` — OpenAI-compatible endpoint
> Lihat detail lengkap di `docs/audit-groq.md`

| Alias       | Model ID                  | RPD    | Role dalam Cascade        |
|-------------|---------------------------|--------|--------------------------|
| `instant`   | `llama-3.1-8b-instant`    | 14,400 | Tier 1: Short query < 40 chars |
| `versatile` | `llama-3.3-70b-versatile` | 1,000  | Tier 4: Gemini quota fallback  |
| `qwen`      | `qwen/qwen3-32b`          | —      | Tier 4: Versatile fallback     |

### Aturan Model ID
- **JANGAN** gunakan model ID tanpa verifikasi ke docs/API resmi
- **JANGAN** hardcode model ID — selalu referensikan via `MODELS.xxx` atau `GROQ_MODELS.xxx`
- `gemini-1.5-flash` sudah **deprecated** di v1beta (404 per Mei 2026)
- `qwen-2.5-32b` **TIDAK ADA** di Groq — model benar: `qwen/qwen3-32b`

---

## 2. Omni-Router: smartRequest Routing Logic

```
smartRequest(chatId, userMessage, imageParts)
│
├─ imageParts.length > 0 → GEMINI ONLY (Groq: text-only)
│   cascade: [flash25 → flash → lite]
│
├─ session.model !== 'auto' (user pilih manual)
│   ├─ Groq model → askWithGroq(session.model)
│   └─ Gemini model → askWithGemini([chosen → flash25 → flash → lite])
│       └─ on 429 → Tier 4 Groq fallback
│
└─ AUTO mode:
    │
    ├─ Tier 1: msgLen < 40 AND GROQ_API_KEY set
    │   └─ askWithGroq(llama-3.1-8b-instant)
    │       └─ on fail → fall to Tier 2/3
    │
    ├─ Tier 3: mode=coding OR isComplex(text)
    │   └─ askWithGemini([pro → flash25 → flash])
    │       └─ on 429 → Tier 4 Groq fallback
    │
    ├─ Tier 2: general
    │   └─ askWithGemini([flash25 → flash → lite])
    │       └─ on 429 → Tier 4 Groq fallback
    │
    └─ Tier 4: Groq heavy fallback
        └─ askWithGroq(llama-3.3-70b-versatile)
            └─ on fail → askWithGroq(qwen/qwen3-32b)
```

### isComplex() Heuristic
Trigger: `hasCode || isDeep || words > 80`
- `hasCode`: regex cek keyword coding (`function`, `class`, `import`, `SELECT`, dll)
- `isDeep`: regex cek kata analitis (`analisis`, `bandingkan`, `evaluasi`, `arsitektur`, dll)
- `words > 80`: panjang pesan

### Trigger Fallback Cascade
| HTTP Status / Kondisi      | Trigger cascade ke model berikutnya? |
|----------------------------|--------------------------------------|
| 404 Not Found              | ✅ Ya                                |
| 429 Too Many Requests      | ✅ Ya → + trigger Groq fallback      |
| 503 Service Unavailable    | ✅ Ya                                |
| `quota` di message         | ✅ Ya                                |
| `overloaded` di message    | ✅ Ya                                |
| 400 Bad Request            | ❌ Tidak (error permanen)            |

---

## 3. System Prompt per Mode

### Aturan Universal (SEMUA mode)
1. **Tag HTML VALID di Telegram**: hanya `<b>`, `<i>`, `<code>`, `<pre>`, `<a>`, `<s>`, `<u>`, `<tg-spoiler>`
2. **DILARANG KERAS** (Telegram tidak mendukung — akan tampil sebagai teks mentah):
   - Markdown: `**`, `__`, `##`, ` ``` `, `---`
   - HTML list: `<ul>`, `<ol>`, `<li>`
   - HTML heading: `<h1>` s/d `<h6>`
   - HTML lain: `<br>`, `<hr>`, `<p>`, `<div>`, `<span>`, `<table>`, `<tr>`, `<td>`
3. Paragraf pendek — max 3-4 baris per blok
4. Tidak ada disclaimer, peringatan, atau "sebagai AI..." yang tidak perlu
5. Framing aturan dalam system prompt: gunakan "Tag HTML yang BOLEH dipakai (hanya ini yang valid di Telegram)" — bukan "Format WAJIB" — agar model lebih patuh

### Mode: `general` (default)
- Adaptif antara casual dan teknis
- Bahasa Indonesia utama, Inggris untuk istilah teknis/kode

### Mode: `coding`
- Karakter: senior engineer
- Wajib: kenapa sebelum bagaimana, step-by-step, tunjukkan alternatif
- Code block: `<pre><code class="language-xxx">`
- Trigger Tier 3 (Gemini Pro) di Omni-Router

### Mode: `analyst`
- Karakter: analis terstruktur
- Struktur: Konteks → Analisis → Implikasi → Rekomendasi
- Identifikasi asumsi tersembunyi

### Mode: `creative`
- Karakter: kreator bebas, out-of-the-box
- Berikan variasi / alternatif, punchy bukan bertele-tele

---

## 4. Session Management

| Item             | Detail                                                     |
|------------------|------------------------------------------------------------|
| Storage          | `sessions.json` (root project, dikecualikan dari git)      |
| Format internal  | Gemini format: `{ role: 'user'|'model', parts: [{ text }] }` |
| History cap      | 40 entries (20 exchange) per session                       |
| Persistence      | Tulis ke file setiap response sukses + SIGINT/SIGTERM      |
| Default session  | `{ history: [], mode: 'general', model: 'auto' }`         |
| Groq conversion  | On-the-fly: Gemini format → OpenAI format via `historyToGroq()` |

### historyToGroq() Rules
- `role: 'model'` → `role: 'assistant'`
- `parts[].text` → `content: string`
- Entry dengan `inlineData` (gambar) → append `'\n[Pengguna mengirim gambar/file]'` ke content

---

## 5. Multimodal

### Gambar
- Handler: `bot.on('photo')`
- Resolusi: `photo[photo.length - 1]` (highest res)
- Ke Gemini: `{ inlineData: { mimeType: 'image/jpeg', data: base64 } }`
- Caption → text prompt; kosong → `'Analisis konten ini.'`
- **Selalu Gemini** — Groq tidak support binary input

### Dokumen
- Handler: `bot.on('document')`
- Size limit: 5 MB
- PDF → `inlineData` ke Gemini (`application/pdf`) — **Selalu Gemini**
- Text file (`text/*`, `application/json`) → decode UTF-8, kirim sebagai text prompt → **routed via smartRequest**

---

## 6. Format Output

| Elemen       | HTML Tag                                      | Kapan                         |
|--------------|-----------------------------------------------|-------------------------------|
| Poin penting | `<b>teks</b>`                                 | Heading, key point            |
| Kode inline  | `<code>teks</code>`                           | Variabel, fungsi, nilai       |
| Blok kode    | `<pre><code>kode</code></pre>`                | Kode panjang                  |
| Blok + lang  | `<pre><code class="language-x">kode</code></pre>` | Kode dengan bahasa          |
| Italic       | `<i>teks</i>`                                 | Catatan, caveat, nuansa       |
| DILARANG     | `**`, `__`, `##`, tabel, backtick triple      | —                             |

### Message Splitting
- Max per chunk: 4000 karakter (buffer dari limit Telegram 4096)
- Split per baris — tidak memotong di tengah
- Fallback: `replyWithHTML` gagal → `reply` plain text

---

## 7. Error Handling

| Kondisi                           | Response ke User                                    |
|-----------------------------------|-----------------------------------------------------|
| Rate limit (semua provider habis) | "⚠️ Rate limit semua provider..."                  |
| HTML render gagal                 | Fallback ke plain text (silent)                     |
| File > 5 MB                       | "⚠️ File terlalu besar. Maksimal 5 MB."            |
| MIME tidak didukung               | Pesan error + daftar format yang OK                 |
| User tidak authorized             | "⛔ Akses tidak diizinkan."                         |
| GROQ_API_KEY tidak diset          | Groq tier diskip, Gemini-only mode (graceful)       |

---

## 8. Checklist Sebelum Deploy

- [ ] Semua model ID diverifikasi ke docs resmi / live API
- [ ] `.env`: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `ALLOWED_USER_IDS`
- [ ] `sessions.json` ada di `.gitignore`
- [ ] Test: pesan pendek (< 40 chars) → Tier 1 Groq
- [ ] Test: pesan coding/complex → Tier 3 Gemini Pro
- [ ] Test: gambar → Gemini vision only
- [ ] Test: PDF → Gemini only
- [ ] Test: dokumen teks → smartRequest (bisa Groq)
- [ ] Test: semua mode (General, Coding, Analyst, Creative)
- [ ] Test: semua model manual (7 pilihan)
- [ ] Console log menampilkan `[Omni-Router]` prefix setiap routing decision

---

## 9. Changelog

| Tanggal    | Perubahan                                                                                     |
|------------|-----------------------------------------------------------------------------------------------|
| 2026-05-04 | v1: Fix `gemini-1.5-flash` 404. Tambah: cascade, 4 mode, multimodal, persistent session.    |
| 2026-05-04 | v2: Integrasikan Groq SDK. Refactor ke `smartRequest` Omni-Router 4-tier. Tambah: 3 Groq model, history converter Gemini→Groq, console routing log. |
