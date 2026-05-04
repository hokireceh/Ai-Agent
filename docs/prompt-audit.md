# Prompt Audit — Telegram Gemini Bot

> Dokumen referensi utama. Semua keputusan terkait model, prompt, dan arsitektur harus mengacu ke sini.
> Update dokumen ini setiap kali ada perubahan model, prompt, atau aturan format.

---

## 1. Model Registry

> **Source of truth:** https://ai.google.dev/gemini-api/docs/models
> **SDK:** `@google/generative-ai@0.21.0` — menggunakan endpoint `v1beta`
> **Terakhir diverifikasi:** Mei 2026

| Alias  | Model ID                          | Kecepatan  | Kualitas   | Free Tier          |
|--------|-----------------------------------|------------|------------|--------------------|
| `lite` | `gemini-2.0-flash-lite`           | ⚡⚡⚡ Sangat cepat | ⭐⭐      | ✅ Ya (30 RPM)     |
| `flash`| `gemini-2.0-flash`                | ⚡⚡ Cepat  | ⭐⭐⭐     | ✅ Ya (60 RPM)     |
| `pro`  | `gemini-2.5-pro-preview-05-06`    | ⚡ Lambat  | ⭐⭐⭐⭐⭐ | ✅ Terbatas (2 RPM)|

### Aturan Model ID
- **JANGAN** gunakan model ID yang tidak ada di tabel di atas tanpa memverifikasi ke docs resmi
- **JANGAN** hardcode model tanpa alias — selalu referensikan via `MODELS.xxx`
- Jika ada model baru, tambahkan ke tabel ini terlebih dahulu sebelum digunakan di kode
- Model `gemini-1.5-flash` sudah **deprecated** di endpoint v1beta (404 Not Found per Mei 2026)

---

## 2. Auto-Cascade Logic

Cascade diaktifkan ketika `session.model === 'auto'` (default).

```
Query masuk
    │
    ▼
detectPreferredModel(text)
    │
    ├─ hasCode || isDeep || words > 80  →  preferred: gemini-2.5-pro-preview-05-06
    │   cascade: [pro, flash, lite]
    │
    └─ otherwise                        →  preferred: gemini-2.0-flash
        cascade: [flash, lite]

Jika model gagal (404 / 429 / 503 / quota / overloaded):
    → fallback ke model berikutnya di cascade
    → log warning ke console
    → TIDAK memberitahu user (transparent fallback)
```

### Trigger Fallback
| HTTP Status | Trigger Cascade? |
|-------------|------------------|
| 404         | ✅ Ya            |
| 429         | ✅ Ya            |
| 503         | ✅ Ya            |
| 400         | ❌ Tidak (error permanen — throw) |
| 5xx lainnya | ✅ Ya            |

---

## 3. System Prompt per Mode

### Aturan Umum (berlaku untuk SEMUA mode)
1. **Format WAJIB HTML Telegram** — gunakan tag `<b>`, `<i>`, `<code>`, `<pre>`
2. **DILARANG** menggunakan markdown (`**`, `__`, `##`, `---`, dll)
3. **DILARANG** menggunakan tabel — Telegram tidak render tabel
4. Paragraf pendek — max 3-4 baris per blok
5. Tidak ada disclaimer, warning, atau pesan "sebagai AI..." yang tidak perlu

### Mode: General
- Karakter: cerdas, adaptif, to the point
- Bahasa: Indonesia utama, Inggris hanya untuk istilah teknis dan kode
- Default untuk semua user baru

### Mode: Coding
- Karakter: senior engineer 10+ tahun
- Wajib: jelaskan *kenapa* sebelum *bagaimana*
- Wajib: step-by-step, tunjukkan alternatif jika ada trade-off
- Code block wajib pakai `<pre><code class="language-xxx">`

### Mode: Analyst
- Karakter: analis terstruktur
- Struktur jawaban: Konteks → Analisis → Implikasi → Rekomendasi
- Wajib: identifikasi asumsi tersembunyi

### Mode: Creative
- Karakter: kreator ide bebas
- Tidak ada batasan konvensional
- Berikan variasi / alternatif

---

## 4. Session Management

- **Storage:** File `sessions.json` di root project
- **Format:** JSON object `{ "[chatId]": { history, mode, model } }`
- **History cap:** 40 entries (20 exchange) per session — entry lama di-trim otomatis
- **History format:** `{ role: 'user'|'model', parts: [{ text }] }` (sesuai Gemini SDK)
- **Persistence:** Simpan ke file setelah setiap response sukses + saat SIGINT/SIGTERM
- **Startup:** Load dari file; jika corrupt → start fresh

### Aturan Session
- History hanya disimpan jika response Gemini SUKSES (tidak error)
- Session baru dibuat otomatis jika chatId belum ada
- Default mode: `general`, default model: `auto`

---

## 5. Multimodal Support

### Gambar (Photo)
- Handler: `bot.on('photo')`
- Resolusi: selalu gunakan `photo[photo.length - 1]` (highest res)
- Format ke Gemini: `{ inlineData: { mimeType: 'image/jpeg', data: base64 } }`
- Caption menjadi text prompt; jika kosong: `'Analisis konten ini.'`

### Dokumen
- Handler: `bot.on('document')`
- Size limit: 5 MB
- MIME type didukung:
  - `application/pdf` → dikirim sebagai `inlineData` ke Gemini
  - `text/*` + `application/json` → decode dari base64 ke UTF-8, kirim sebagai text prompt (max 8000 char)
- MIME type tidak didukung → tolak dengan pesan error yang jelas

---

## 6. Format Output (HTML Telegram)

| Elemen           | Tag HTML                                | Kapan digunakan                        |
|------------------|-----------------------------------------|----------------------------------------|
| Teks penting     | `<b>teks</b>`                           | Poin kunci, heading                    |
| Kode inline      | `<code>kode</code>`                     | Nama variabel, perintah, nilai penting |
| Blok kode        | `<pre><code>kode</code></pre>`          | Kode panjang                           |
| Blok kode + lang | `<pre><code class="lang-x">kode</code></pre>` | Kode dengan syntax highlighting  |
| Italic           | `<i>teks</i>`                           | Catatan, nuansa, caveat               |
| Dilarang         | `**`, `__`, `##`, tabel, ` ``` `       | —                                      |

### Message Splitting
- Max per pesan: 4000 karakter (buffer dari limit Telegram 4096)
- Split per baris, bukan karakter — hindari memotong tag HTML di tengah
- Fallback: jika `replyWithHTML` gagal → kirim sebagai plain text

---

## 7. Error Handling

| Kondisi                          | Response ke User                                        |
|----------------------------------|---------------------------------------------------------|
| Rate limit (429)                 | "⚠️ Rate limit tercapai. Tunggu sebentar..."           |
| Semua model cascade habis        | Error terakhir ditampilkan                              |
| HTML render gagal                | Fallback ke plain text (silent)                         |
| File terlalu besar               | "⚠️ File terlalu besar. Maksimal 5 MB."               |
| MIME type tidak didukung         | Pesan error + daftar format yang didukung              |
| User tidak authorized            | "⛔ Akses tidak diizinkan."                            |

---

## 8. Checklist Sebelum Deploy

- [ ] Semua model ID dicek ke docs resmi Google AI
- [ ] `.env` sudah diisi: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `ALLOWED_USER_IDS`
- [ ] `sessions.json` ada di `.gitignore`
- [ ] Bot ditest dengan: pesan teks, gambar, dokumen PDF, dokumen teks
- [ ] Cascade ditest dengan mensimulasikan quota error
- [ ] Semua mode ditest (General, Coding, Analyst, Creative)
- [ ] `/start`, `/menu`, `/new`, `/info` semua berjalan

---

## 9. Changelog

| Tanggal    | Perubahan                                                                 |
|------------|---------------------------------------------------------------------------|
| 2026-05-04 | Initial audit. Fix: `gemini-1.5-flash` deprecated → `gemini-2.0-flash`. Tambah: auto-cascade, 4 mode, multimodal (foto + dokumen), persistent session. |
