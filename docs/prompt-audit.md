# Prompt Audit — Telegram Omni-Router Bot

> Dokumen referensi utama. Semua keputusan terkait model, prompt, routing, dan arsitektur harus mengacu ke sini.
> Update dokumen ini setiap kali ada perubahan model, prompt, atau aturan format.

---

## 1. Model Registry

### Gemini (source: ai.google.dev/gemini-api/docs/models — verified May 2026)

> SDK: `@google/generative-ai@0.21.0` — endpoint `v1beta`

| Alias     | Model ID                         | Speed   | Quality    | Free Tier          | Role dalam Cascade      |
|-----------|----------------------------------|---------|------------|--------------------|-------------------------|
| `lite`    | `gemini-2.0-flash-lite`          | ⚡⚡⚡  | ⭐⭐       | ✅ Ya (30 RPM)     | Safety net terakhir      |
| `flash`   | `gemini-2.0-flash`               | ⚡⚡    | ⭐⭐⭐     | ✅ Ya (60 RPM)     | Fallback Tier 2/3        |
| `flash25` | `gemini-2.5-flash`               | ⚡⚡    | ⭐⭐⭐⭐   | ✅ Ya              | Tier 2/3: Default entry  |
| `pro`     | `gemini-2.5-pro-preview-05-06`   | ⚡      | ⭐⭐⭐⭐⭐ | ⚠️ Terbatas (2 RPM) | Manual only — bukan auto |

> ⚠️ `gemini-2.5-pro` **tidak masuk cascade auto** — hanya tersedia lewat model picker manual.
> Jika user pilih Pro manual dan kena 429, langsung fallback ke Tier 4 Groq.

### Groq (source: live API `GET api.groq.com/openai/v1/models` — verified May 2026)

> SDK: `groq-sdk` — OpenAI-compatible endpoint
> Pool: `GROQ_ALL_KEYS = [...new Set([GROQ_API_KEY, GROQ_ADMIN_API_KEY])]` — round-robin, deduplicated

| Alias       | Model ID                  | RPM | RPD    | Token Limit | Role dalam Cascade              |
|-------------|---------------------------|-----|--------|-------------|----------------------------------|
| `instant`   | `llama-3.1-8b-instant`    | 30  | 14,400 | 8,192       | Tier 1: Short query < 40 chars   |
| `versatile` | `llama-3.3-70b-versatile` | 30  | 1,000  | 32,768      | Tier 4: Gemini quota fallback    |
| `qwen`      | `qwen/qwen3-32b`          | 60  | —      | 32,768      | Tier 4: Versatile fallback       |

> ⚠️ `qwen-2.5-32b` **TIDAK ADA** di Groq. Model benar: `qwen/qwen3-32b`.
> Selalu referensikan via `GROQ_MODELS.xxx`, jangan hardcode.

### Aturan Model ID
- **JANGAN** hardcode model ID — selalu via `MODELS.xxx` atau `GROQ_MODELS.xxx` dari `src/config.js`
- `gemini-1.5-flash` sudah **deprecated** di v1beta (404 per Mei 2026)
- `gemini-2.5-pro` membutuhkan billing / akses khusus — jangan masuk auto cascade

---

## 2. Omni-Router: smartRequest Routing Logic

```
smartRequest(chatId, userMessage, imageParts)
│
├─ imageParts.length > 0 → GEMINI ONLY (Groq: text-only)
│   cascade: [flash25 → flash → lite]
│
├─ session.model !== 'auto' (user pilih manual)
│   ├─ Groq model → askWithGroq(session.model) — satu call, no cascade
│   └─ Gemini model → askWithGemini([chosen → flash25 → flash → lite])
│       └─ on 429/quota → Tier 4 Groq fallback (versatile → qwen)
│
└─ AUTO mode:
    │
    ├─ Tier 1: msgLen < 40 AND GROQ_ALL_KEYS.length > 0
    │   └─ askWithGroq(llama-3.1-8b-instant) [multi-key round-robin]
    │       └─ on fail → cascade ke Tier 2/3
    │
    ├─ Tier 2/3: Gemini Flash 2.5 (complex & general SAMA entry point)
    │   └─ askWithGemini([flash25 → flash → lite])
    │       └─ on 429/quota → Tier 4 Groq fallback
    │
    └─ Tier 4: Groq heavy fallback
        └─ askWithGroq(llama-3.3-70b-versatile)
            └─ on fail → askWithGroq(qwen/qwen3-32b)
```

> **Catatan penting:** Tier 2 dan Tier 3 sekarang pakai cascade yang sama (`flash25 → flash → lite`).
> Yang membedakan hanya log message. Tidak ada routing terpisah berdasarkan mode — AI auto-adapt via `ADAPTIVE_PROMPT`.

### isComplex() Heuristic
Trigger: `hasCode || isDeep || words > 80`
- `hasCode`: regex cek keyword coding (`function`, `class`, `import`, `SELECT`, dll)
- `isDeep`: regex cek kata analitis (`analisis`, `jelaskan detail`, `bandingkan`, `evaluasi`, `rancang`, `arsitektur`, `optimasi`, `strategi`)
- `words > 80`: panjang pesan

### Trigger Fallback Cascade
| HTTP Status / Kondisi       | Trigger cascade ke model berikutnya? |
|-----------------------------|--------------------------------------|
| 404 Not Found               | ✅ Ya                                |
| 429 Too Many Requests       | ✅ Ya → + trigger Groq fallback      |
| 503 Service Unavailable     | ✅ Ya                                |
| `quota` di message          | ✅ Ya                                |
| `overloaded` di message     | ✅ Ya                                |
| `not found` di message      | ✅ Ya                                |
| 400 Bad Request             | ❌ Tidak (error permanen)            |

### Multi-Key Groq Pool
```javascript
// src/config.js
GROQ_ALL_KEYS = [...new Set([GROQ_API_KEY, GROQ_ADMIN_API_KEY].filter(Boolean))]

// round-robin via groqCreate() di router.js dan admin.js
// 429 → langsung switch ke key berikutnya di pool
// Pool sama dipakai untuk chat (router) dan admin AI
```

---

## 3. System Prompt

### Tidak ada mode system
Mode manual (`general`, `coding`, `analyst`, `creative`) **telah dihapus**.
Digantikan dengan satu **`ADAPTIVE_PROMPT`** di `src/prompts.js` — AI auto-deteksi konteks dari isi pesan.

### ADAPTIVE_PROMPT (ringkasan)
```
Karakter: adaptif, to the point, no disclaimer
Auto-adaptasi:
  - Coding/teknis    → senior engineer, kenapa sebelum bagaimana, edge case & trade-off
  - Analisis/data    → Konteks → Analisis → Implikasi → Rekomendasi
  - Kreatif          → bebas, berikan variasi
  - Percakapan umum  → ringkas, langsung ke inti

FORMAT OUTPUT: WAJIB IKUTI PERSIS
Tag valid (hanya 4): <b>, <i>, <code>, <pre><code>
DILARANG: **, __, ##, backtick triple, <ul>, <ol>, <li>, <br>, <h1>-<h6>, <p>, <div>
Daftar: gunakan "- item" manual
Paragraf: max 3-4 baris per blok
```

Lihat teks lengkap di: `src/prompts.js`

### Framing Efektif
- Gunakan framing positif ("Hanya gunakan 4 tag HTML ini") + daftar negatif eksplisit ("DILARANG KERAS")
- Framing gabungan ini lebih efektif dari hanya framing negatif saja (lesson dari Issue #005)

---

## 4. Sanitizer Pipeline (`sanitizeForTelegram`)

Dijalankan di `sendLong()` sebelum setiap pengiriman. Defense-in-depth walaupun system prompt sudah ketat.

```
Input raw AI text
  │
  ├─  0. Strip <think>...</think> blocks  (Qwen3 reasoning — selalu hidden dari user)
  ├─  1. Markdown ``` → <pre><code>       (konten di-escape)
  ├─  2. Inline `backtick` → <code>       (konten di-escape)
  ├─  3. ## heading → <b>
  ├─  4. **bold** / __bold__ → <b>
  ├─  5. *italic* / _italic_ → <i>
  ├─  6. Protect valid tags dengan placeholder \x00N\x00
  ├─  7. Illegal tag conversion:
  │       <br> → \n | <li> → "- text\n" | <ul>/<ol> → strip | <hN> → <b>
  ├─  8. Strip semua tag HTML tersisa
  ├─  9. Escape bare & → &amp; | < → &lt; | > → &gt;
  ├─ 10. Restore valid tags dari placeholder
  └─ 11. Collapse 3+ blank lines → 2
```

**Tag valid & diproteksi:** `<b>`, `<i>`, `<s>`, `<u>`, `<code>`, `<pre>`, `<a>`
**Semua tag lain:** dikonversi ke teks atau di-strip

---

## 5. Session Management

| Item            | Detail                                                              |
|-----------------|---------------------------------------------------------------------|
| Storage         | NeonDB (PostgreSQL via `pg`) — tabel `sessions`                    |
| Format internal | Gemini format: `{ role: 'user'|'model', parts: [{ text }] }`      |
| History cap     | 40 entries (20 exchange) — trim ke `slice(-40)` setiap save        |
| Context window  | `slice(-30)` saat kirim ke model — buffer dari hard cap            |
| Persistence     | Save ke DB setiap response sukses                                   |
| Default session | `{ history: [], model: 'auto' }`                                   |
| Groq conversion | On-the-fly: Gemini format → OpenAI format via `historyToGroq()`    |

> **Tidak ada `session.mode`** — field mode sudah dihapus sepenuhnya.
> Satu-satunya preference user yang disimpan: `session.model` (`'auto'` atau model ID).

### historyToGroq() Rules
- `role: 'model'` → `role: 'assistant'`
- `parts[].text` → `content: string`
- Entry dengan `inlineData` (gambar) → append `'\n[Pengguna mengirim gambar/file]'`
- System prompt: entry pertama `{ role: 'system', content: ADAPTIVE_PROMPT }`

---

## 6. Multimodal

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
- Text file (`text/*`, `application/json`) → decode UTF-8, kirim sebagai text prompt → **routed via smartRequest** (bisa kena Tier 1 Groq)

---

## 7. Format Output

| Elemen      | HTML Tag                                          | Kapan                         |
|-------------|---------------------------------------------------|-------------------------------|
| Poin penting| `<b>teks</b>`                                     | Heading, key point            |
| Kode inline | `<code>teks</code>`                               | Variabel, fungsi, nilai       |
| Blok kode   | `<pre><code>kode</code></pre>`                    | Kode panjang                  |
| Blok + lang | `<pre><code class="language-x">kode</code></pre>` | Kode dengan bahasa            |
| Italic      | `<i>teks</i>`                                     | Catatan, caveat, nuansa       |
| DILARANG    | `**`, `__`, `##`, tabel, backtick triple          | —                             |

### Message Splitting (sendLong)
- Max per chunk: 4000 karakter (buffer dari limit Telegram 4096)
- Split per baris — tidak memotong di tengah kalimat
- Fallback: `replyWithHTML` gagal → `reply` plain text (silent)

---

## 8. Error Handling

| Kondisi                            | Response ke User                                    |
|------------------------------------|-----------------------------------------------------|
| Rate limit (semua provider habis)  | "⚠️ Rate limit semua provider..."                  |
| HTML render gagal                  | Fallback ke plain text (silent)                     |
| File > 5 MB                        | "⚠️ File terlalu besar. Maksimal 5 MB."            |
| MIME tidak didukung                | Pesan error + daftar format yang OK                 |
| User tidak authorized              | "⛔ Akses tidak diizinkan."                         |
| GROQ_ALL_KEYS kosong               | Groq tier diskip, Gemini-only mode (graceful)       |
| Groq 429                           | Langsung rotasi ke key berikutnya di pool           |

---

## 9. Checklist Sebelum Deploy

- [ ] Semua model ID diverifikasi ke docs resmi / live API
- [ ] `.env`: `BOT_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GROQ_ADMIN_API_KEY`, `DATABASE_URL`, `ADMIN_ID`, `ALLOWED_USER_IDS`
- [ ] `GROQ_ALL_KEYS` pool muncul di startup log: `[N key — N× TPM]`
- [ ] Test: pesan pendek (< 40 chars) → Tier 1 Groq Llama 8B
- [ ] Test: pesan panjang/coding/analisis → Tier 2/3 Gemini Flash 2.5
- [ ] Test: gambar → Gemini vision only (bukan Groq)
- [ ] Test: PDF → Gemini only
- [ ] Test: dokumen teks → smartRequest (bisa kena Tier 1 Groq)
- [ ] Test: model manual Groq → satu call langsung tanpa cascade
- [ ] Test: model manual Gemini Pro → fallback ke Groq jika 429
- [ ] Console log menampilkan `[Omni-Router]` prefix setiap routing decision
- [ ] `<think>` block dari Qwen3 tidak muncul di response user

---

## 10. Changelog

| Tanggal    | Perubahan                                                                                                                   |
|------------|-----------------------------------------------------------------------------------------------------------------------------|
| 2026-05-04 | v1: Fix `gemini-1.5-flash` 404. Tambah: cascade, 4 mode, multimodal, persistent session.                                   |
| 2026-05-04 | v2: Integrasikan Groq SDK. Refactor ke `smartRequest` Omni-Router 4-tier. Tambah: 3 Groq model, historyToGroq converter.   |
| 2026-05-05 | v3: Hapus mode system → single ADAPTIVE_PROMPT. NeonDB replace sessions.json. Multi-key Groq pool (GROQ_ALL_KEYS). Sanitizer 11-step pipeline. `gemini-2.5-pro` keluar dari auto cascade. |
