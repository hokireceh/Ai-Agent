# Telegram Omni-Router Bot

Bot AI personal via Telegram dengan sistem routing multi-provider (Gemini + Groq), 4 mode interaksi, dan admin panel dengan second AI assistant untuk analisis kode.

## Stack

- **Runtime:** Node.js
- **Bot Framework:** Telegraf v4
- **AI Providers:** Google Gemini (`@google/generative-ai@0.21.0`) + Groq (`groq-sdk`)

## Arsitektur

### Omni-Router (`smartRequest`)
Sistem routing otomatis 4-tier yang memilih model berdasarkan konteks query:

| Tier | Kondisi | Provider / Model |
|------|---------|-----------------|
| 1 | Pesan < 40 karakter | Groq `llama-3.1-8b-instant` |
| 2 | Query umum | Gemini `gemini-2.5-flash` → fallback |
| 3 | Mode Coding / query kompleks | Gemini `gemini-2.5-pro-preview-05-06` → fallback |
| 4 | Gemini 429 quota | Groq `llama-3.3-70b-versatile` → `qwen/qwen3-32b` |

Gambar & PDF selalu ke Gemini (Groq tidak support binary input).

### Admin Panel (`/admin`)
Second AI assistant khusus admin — analisis source code bot secara real-time menggunakan Groq `qwen/qwen3-32b` instance terpisah.

Fitur admin:
- **🔍 Diagnosa Kode** — bug detection dan prioritized issue list
- **📋 Full Audit** — arsitektur, keamanan, performa (skor 1-10 per aspek)
- **📊 System Status** — uptime, memory, session count, model config
- **🧹 Reset Semua Session** — clear history semua user
- **🧪 Test Sanitizer** — verifikasi HTML sanitizer pipeline
- **Free chat** — ketik pertanyaan langsung, dijawab oleh code auditor AI

Admin bisa menggunakan Groq API key terpisah (`GROQ_ADMIN_API_KEY`) untuk rate limit independen.

### HTML Sanitizer (`sanitizeForTelegram`)
Pipeline 8-step yang berjalan di setiap pesan sebelum dikirim ke Telegram:
1. Markdown ` ``` ` → `<pre><code>` (konten di-escape)
2. Inline backtick → `<code>`
3. Protect valid tags dengan placeholder
4. `<br>`→`\n` | `<li>`→`- text` | `<ul>/<ol>`→strip | `<hN>`→plain text
5. Strip semua tag HTML tersisa
6. Escape bare `&` `<` `>`
7. Restore valid tags
8. Collapse blank lines berlebih

### Session Management
- Persistent via `sessions.json` (file-based, load on startup, write on change)
- History format: Gemini format sebagai single source of truth
- Konversi on-the-fly ke OpenAI format untuk Groq calls
- Cap: 40 entries (20 exchange) per session
- Session fields: `{ history, mode, model, adminMode }`

## File Structure

```
index.js          — main bot logic (Omni-Router, handlers, sanitizer, admin)
sessions.json     — persistent sessions (gitignored)
docs/
  prompt-audit.md — referensi utama: model IDs, routing rules, prompt rules
  audit-gemini.md — Gemini SDK behavior, known issues (#001–#006)
  audit-groq.md   — Groq API model registry, format differences
.env              — secrets (lihat tabel env vars di bawah)
.gitignore        — exclude: node_modules, .env, sessions.json
```

## Environment Variables

| Variable | Required | Keterangan |
|----------|----------|------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token dari @BotFather |
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key |
| `GROQ_API_KEY` | ⚠️ Optional | Groq console API key. Tanpa ini, Tier 1 & 4 dinonaktifkan |
| `ALLOWED_USER_IDS` | ⚠️ Optional | Comma-separated Telegram user IDs. Kosong = akses terbuka |
| `ADMIN_USER_IDS` | ⚠️ Optional | Comma-separated admin Telegram IDs. Kosong = admin dinonaktifkan |
| `GROQ_ADMIN_API_KEY` | ⚠️ Optional | Groq key khusus admin. Fallback ke `GROQ_API_KEY` jika tidak diset |

## Mode Interaksi

| Mode | Karakter | Trigger Tier |
|------|----------|-------------|
| General | Adaptif, to the point | 2 |
| Coding | Senior engineer, step-by-step | 3 (Pro) |
| Analyst | Terstruktur, Konteks→Analisis→Rekomendasi | 2 |
| Creative | Bebas, multi-alternatif | 2 |

## Commands

- `/start` — salam + main menu
- `/menu` — tampilkan main menu
- `/new` — reset chat history
- `/info` — info model & session aktif
- `/admin` — buka admin panel (hanya ADMIN_USER_IDS)

## Referensi Docs

Semua keputusan model ID, routing, dan prompt rules ada di `docs/prompt-audit.md`.
Jangan ubah model ID tanpa memverifikasi ke docs resmi / live API terlebih dahulu.
