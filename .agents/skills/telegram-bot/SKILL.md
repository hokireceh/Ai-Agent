---
name: telegram-bot
description: Panduan lengkap project Telegram AI Bot (Omni-Router). Gunakan skill ini setiap kali mengerjakan task apapun di project ini — modifikasi prompt, routing, session, Surf API, admin panel, shell executor, atau fitur baru.
---

# Telegram Omni-Router Bot

Bot AI personal via Telegram. Stack: Node.js + Telegraf v4 + Gemini + Groq + NeonDB (PostgreSQL).

## File Structure

```
index.js                  — entry point, bot launch, SIGINT/SIGTERM handler
src/
  config.js               — env vars, model registry (MODELS, GROQ_MODELS), allowed users
  prompts.js              — ADAPTIVE_PROMPT: system prompt tunggal untuk semua mode
  router.js               — Omni-Router (smartRequest), askWithGemini, askWithGroq
  handlers.js             — semua Telegraf handler: commands, callbacks, text, photo, document
  sanitizer.js            — sanitizeForTelegram (8-step pipeline), sendLong, escapeHtml, downloadAsBase64
  menus.js                — inline keyboards & reply keyboards
  admin.js                — admin AI (Groq Qwen3), analyzeWithContext, getSystemHealth, getDBHealth
  scheduler.js            — heartbeat NeonDB setiap jam
  surf.js                 — Surf API integration: price, ranking, fear/greed, airdrop, gainers, IDR
  utils/
    session.js            — NeonDB sessions (in-memory cache + PostgreSQL persistence)
    shell.js              — runShell(), formatShellOutput() — shell executor untuk admin
```

## Environment Variables

| Var | Wajib | Keterangan |
|-----|-------|------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token @BotFather |
| `GEMINI_API_KEY` | ✅ | Google AI Studio |
| `GROQ_API_KEY` | ⚠️ | Groq console. Tanpa ini Tier 1 & 4 nonaktif |
| `GROQ_ADMIN_API_KEY` | ⚠️ | Groq key khusus admin. Fallback ke GROQ_API_KEY |
| `SURF_API_KEY` | ⚠️ | asksurf.ai. Tanpa ini crypto data injection nonaktif |
| `DATABASE_URL` | ✅ | NeonDB connection string |
| `ALLOWED_USER_IDS` | ⚠️ | Comma-separated user IDs. Kosong = akses terbuka |
| `ADMIN_USER_IDS` | ⚠️ | Comma-separated admin IDs. Kosong = admin nonaktif |

## Omni-Router (`smartRequest`)

Routing 4-tier otomatis di `src/router.js`:

| Tier | Kondisi | Provider / Model |
|------|---------|-----------------|
| 1 | Pesan < 40 char & no surf context | Groq `llama-3.1-8b-instant` |
| 2/3 | General / complex / surf-enriched | Gemini `gemini-2.5-flash` → flash → lite |
| 3 | Multimodal (foto/PDF) | Gemini only (Groq tidak support binary) |
| 4 | Gemini 429 quota | Groq `llama-3.3-70b-versatile` → `qwen/qwen3-32b` |

Signature: `smartRequest(chatId, userMessage, imageParts = [], saveMessage = null)`
- `saveMessage` — yang disimpan ke history. Diisi kalau `userMessage` sudah di-enrich (e.g., reply context atau surf context)

## Surf API (`src/surf.js`)

Base URL: `https://api.asksurf.ai/gateway/v1`

Endpoint yang tersedia (verified):
- `/market/price?symbol=X&time_range=1d` — harga token
- `/market/ranking?sort_by=market_cap&limit=N` — top by market cap
- `/market/ranking?sort_by=change_24h&limit=N` — top gainers
- `/market/fear-greed?from=DATE&to=DATE` — fear & greed index
- `/search/airdrop?phase=active,claimable&has_open=true&sort_by=total_raise&limit=N` — airdrop aktif

**TIDAK tersedia:** TGE date, DEX analytics, news, social data, token detail page.

Context injection otomatis kalau `isCrypto(text)` return true. Tambah keyword di `CRYPTO_REGEX` jika ada istilah baru.

Price card (USD + IDR) hanya muncul jika ada **nominal** di query (e.g., "1 HYPE", "5 BTC"). IDR rate dari `frankfurter.app`.

## Session Management

- In-memory `Map` sebagai cache (read selalu dari sini)
- Persistent ke NeonDB (upsert setiap AI response)
- Format: `{ history: [], mode: 'general', model: 'auto', adminMode: false }`
- History cap: 40 entries (20 exchange). Format Gemini, konversi ke OpenAI on-the-fly untuk Groq

## Admin Panel (`/admin`)

Aktif hanya untuk `ADMIN_USER_IDS`. Masuk dengan `/admin` atau tombol admin panel.

Fitur admin:
- **AI Code Analyzer** — free chat, dijawab Groq Qwen3 32B dengan context source code
- **🖥️ Shell Executor** — ketik `$ <command>` untuk jalankan shell command langsung dari chat (timeout 15s)
- **🔍 Log Diagnosa** — analyze runtime log
- **📊 System Status** — uptime, memory, NeonDB health
- **🧹 Reset Semua Session** — clear semua history user
- **🧪 Test Sanitizer** — verifikasi HTML sanitizer pipeline

## Reply Context

Kalau user reply ke pesan tertentu, isi pesan yang di-reply otomatis disertakan ke konteks AI:
```
[User membalas pesan ini: "...isi pesan..."]

<pesan user>
```
Ini mencegah AI salah interpretasi pronoun ("itu", "ini", "dia").

## Prompt (`src/prompts.js`)

Single `ADAPTIVE_PROMPT` untuk semua mode. Key rules:
- Gaya: campur Indonesia + Jawa, zero disclaimer
- Akurasi: angka live hanya dari `[DATA REAL-TIME]`, info historis boleh dari training
- Chart analysis: wajib detail 6 poin (structure, levels, price action, bullish, bearish, bias)
- PRICE CARD: tampilkan verbatim dalam `<code>` tag
- LARANGAN: jangan pura-pura fetch/execute atau fabrikasi JSON/output

## HTML Sanitizer (`src/sanitizer.js`)

Pipeline 8-step sebelum kirim ke Telegram. Output hanya boleh 4 tag:
`<b>`, `<i>`, `<code>`, `<pre><code>`

`sendLong()` — auto split pesan > 4096 karakter.

## Common Tasks

### Tambah keyword crypto detector
Edit `CRYPTO_REGEX` di `src/surf.js` — tambah di bagian yang sesuai (ticker, keyword, atau perp DEX protocols).

### Ubah routing logic
Edit `smartRequest()` di `src/router.js`. Jangan ubah model IDs tanpa verifikasi ke `src/config.js`.

### Tambah admin button
1. Tambah button di `adminMenu` / `adminMiniMenu` di `src/menus.js`
2. Tambah handler `bot.action('action_id', ...)` di `src/handlers.js`

### Ubah system prompt
Edit `ADAPTIVE_PROMPT` di `src/prompts.js`. Restart bot setelah edit.

### Tambah Surf endpoint
1. Tambah fetcher function di `src/surf.js`
2. Tambah ke `fetchMap` di `fetchCryptoContext()`
3. Inject ke context string

### Restart bot
Restart workflow `Open Ai` setelah setiap perubahan kode.
