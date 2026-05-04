# Telegram Omni-Router Bot

Bot AI personal via Telegram dengan sistem routing multi-provider (Gemini + Groq) dan 4 mode interaksi.

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

### Session Management
- Persistent via `sessions.json` (file-based, load on startup, write on change)
- History format: Gemini format sebagai single source of truth
- Konversi on-the-fly ke OpenAI format untuk Groq calls
- Cap: 40 entries (20 exchange) per session

## File Structure

```
index.js          — main bot logic (Omni-Router, handlers, cascade)
sessions.json     — persistent sessions (gitignored)
docs/
  prompt-audit.md — referensi utama: model IDs, routing rules, prompt rules
  audit-gemini.md — Gemini SDK behavior, known issues
  audit-groq.md   — Groq API model registry, format differences
.env              — TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, GROQ_API_KEY, ALLOWED_USER_IDS
.gitignore        — exclude: node_modules, .env, sessions.json
```

## Environment Variables

| Variable | Required | Keterangan |
|----------|----------|------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token dari @BotFather |
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key |
| `GROQ_API_KEY` | ⚠️ Optional | Groq console API key. Tanpa ini, Tier 1 & 4 dinonaktifkan |
| `ALLOWED_USER_IDS` | ⚠️ Optional | Comma-separated Telegram user IDs. Kosong = akses terbuka |

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

## Referensi Docs

Semua keputusan model ID, routing, dan prompt rules ada di `docs/prompt-audit.md`.
Jangan ubah model ID tanpa memverifikasi ke docs resmi / live API terlebih dahulu.
