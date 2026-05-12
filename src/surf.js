'use strict';

const SURF_KEY      = process.env.SURF_API_KEY;
const SURF_BASE     = 'https://api.asksurf.ai/gateway/v1';
const FETCH_TIMEOUT = 8000; // ms — jangan block response lama

// ─── Crypto Query Detector ─────────────────────────────────────────────────────
// Return true jika pesan berkaitan dengan crypto / market / web3
const CRYPTO_REGEX = new RegExp([
  // Token tickers umum
  '\\b(BTC|ETH|SOL|BNB|XRP|ADA|AVAX|DOT|MATIC|LINK|UNI|AAVE|ARB|OP|SUI|APT|INJ|TIA|SEI|DOGE|SHIB|PEPE|WIF|BONK|JUP|W|PYTH|STRK|MANTA|ALT|DYM|PIXEL|PORTAL|NFP|AI|XAI|MAVIA|SLERF|BOME|PONKE|MOG|POPCAT|NEIRO|GOAT|PNUT|ACT|CHILLGUY|VIRTUAL|AI16Z|AIXBT|ZEREBRO|GRIFFAIN|FARTCOIN|TRUMP|MELANIA|LIBRA|VINE|KEKIUS|PNUT|MOVE|HYPE|HBAR|TON|NOT|DOGS|HMSTR|CATI|MAJOR|BLUM|UXLINK|SEED|DOGS|BEES)\\b',
  // Kata kunci crypto
  '\\b(bitcoin|ethereum|crypto|blockchain|defi|nft|token|coin|airdrop|testnet|mainnet|wallet|metamask|web3|dex|cex|swap|liquidity|yield|farming|staking|bridge|layer2|l2|rollup|zk|optimistic|arbitrum|optimism|base|polygon|solana|avalanche|bsc|binance|coinbase|bybit|okx|kucoin|gate|kraken|bitget)\\b',
  // Market & trading terms
  '\\b(harga|price|mcap|market cap|volume|ath|atl|pump|dump|bull|bear|long|short|futures|perp|funding|liquidation|leverage|margin|entry|exit|support|resistance|rsi|macd|ema|sma|ta|fa|tokenomics|vesting|unlock|supply|circulating|fdv)\\b',
  // Query patterns
  '(harga |price |berapa |worth |nilai |cek |check ).{0,20}(coin|token|crypto|btc|eth|sol|bnb)',
  '(inpo|info|update|news).{0,10}(btc|eth|sol|crypto|market|coin)',
  '(fear|greed|sentiment|market condition|kondisi market)',
  '(chart|grafik|candle|trend|analisis|analysis).{0,20}(crypto|coin|token)',
  '(smart money|whale|holder|top holder)',
  '(polymarket|kalshi|prediction market)',
].join('|'), 'i');

function isCrypto(text) {
  return CRYPTO_REGEX.test(text);
}

// ─── Token Extractor ───────────────────────────────────────────────────────────
// Ekstrak ticker symbols dari teks user
const KNOWN_TICKERS = new Set([
  'BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOT','MATIC','LINK','UNI',
  'AAVE','ARB','OP','SUI','APT','INJ','TIA','SEI','DOGE','SHIB','PEPE',
  'WIF','BONK','JUP','W','PYTH','STRK','HYPE','TON','NOT','HBAR','MOVE',
  'TRUMP','VIRTUAL','AI16Z','AIXBT','FARTCOIN','POPCAT','NEIRO','GOAT',
  'ACT','PNUT','MOG','PONKE','BOME','SLERF','MAVIA','PIXEL','PORTAL',
]);

function extractTickers(text) {
  const found = new Set();
  const words  = text.toUpperCase().split(/\W+/);
  for (const w of words) {
    if (KNOWN_TICKERS.has(w)) found.add(w);
  }
  // Selalu include BTC sebagai baseline
  found.add('BTC');
  // Include ETH jika ada context defi/token
  if (/defi|token|nft|swap|eth|ethereum/i.test(text)) found.add('ETH');
  return [...found].slice(0, 5); // max 5 token
}

// ─── HTTP Fetch Helper ─────────────────────────────────────────────────────────
async function surfFetch(path) {
  if (!SURF_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`${SURF_BASE}${path}`, {
      headers: { Authorization: `Bearer ${SURF_KEY}` },
      signal:  ctrl.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Individual Fetchers ───────────────────────────────────────────────────────
async function fetchPrice(symbol) {
  const data = await surfFetch(`/market/price?symbol=${symbol}&time_range=1d`);
  if (!data?.length) return null;
  // Ambil titik terakhir (paling baru)
  const latest = data[data.length - 1];
  // Ambil titik 24h lalu untuk hitung perubahan
  const oldest = data[0];
  const change24h = oldest.value > 0
    ? ((latest.value - oldest.value) / oldest.value * 100).toFixed(2)
    : null;
  return { symbol, price: latest.price ?? latest.value, change24h };
}

async function fetchTopMarkets(limit = 8) {
  const data = await surfFetch(`/market/ranking?sort_by=market_cap&limit=${limit}`);
  if (!data?.length) return null;
  return data.map(t => ({
    symbol:    t.symbol,
    name:      t.name,
    price:     t.price_usd,
    change24h: t.change_24h_pct?.toFixed(2),
    mcap:      t.market_cap_usd,
    high24h:   t.high_24h,
    low24h:    t.low_24h,
    volume24h: t.volume_24h_usd,
  }));
}

async function fetchFearGreed() {
  const today = new Date();
  const from  = new Date(today - 3 * 86400000).toISOString().slice(0, 10);
  const to    = today.toISOString().slice(0, 10);
  const data  = await surfFetch(`/market/fear-greed?from=${from}&to=${to}`);
  if (!data?.length) return null;
  const latest = data[data.length - 1];
  return {
    value:          latest.value,
    classification: latest.classification,
    date:           new Date(latest.timestamp * 1000).toISOString().slice(0, 10),
  };
}

async function fetchAirdrops() {
  const data = await surfFetch(
    '/search/airdrop?phase=active,claimable&has_open=true&sort_by=total_raise&limit=5'
  );
  if (!data?.length) return null;
  return data.map(a => ({
    name:       a.project_name,
    symbol:     a.coin_symbol || '?',
    status:     a.status,
    raise:      a.total_raise,
    tasksOpen:  a.task_summary?.open ?? 0,
    tasksTotal: a.task_summary?.total ?? 0,
  }));
}

// ─── Main Context Builder ──────────────────────────────────────────────────────
async function fetchCryptoContext(userText) {
  if (!SURF_KEY) return null;

  const isAirdropQuery  = /airdrop|farming|farm|garap|task|testnet/i.test(userText);
  const tickers         = extractTickers(userText);
  const isSpecificToken = tickers.filter(t => t !== 'BTC' && t !== 'ETH').length > 0;

  try {
    // Selalu fetch: fear & greed + top market (baseline)
    // Gunakan named map agar ordering tidak kacau
    const fetchMap = {
      fearGreed:  fetchFearGreed(),
      topMarkets: fetchTopMarkets(8),
    };

    // Fetch harga spesifik jika ada ticker non-mainstream di query
    const extraTickers = tickers.filter(t => !['BTC','ETH','SOL','BNB','XRP'].includes(t));
    if (isSpecificToken && extraTickers.length > 0) {
      fetchMap.extraPrice = fetchPrice(extraTickers[0]);
    }

    // Fetch airdrop jika query tentang airdrop/farming
    if (isAirdropQuery) {
      fetchMap.airdrops = fetchAirdrops();
    }

    // Await semua sekaligus
    const keys    = Object.keys(fetchMap);
    const values  = await Promise.all(Object.values(fetchMap));
    const res     = Object.fromEntries(keys.map((k, i) => [k, values[i]]));

    const { fearGreed, topMarkets, extraPrice, airdrops } = res;

    // Build context string
    const lines = ['[DATA REAL-TIME — diambil live dari Surf API, bukan training data]'];
    lines.push(`Waktu fetch: ${new Date().toUTCString()}`);
    lines.push('');

    if (fearGreed) {
      lines.push(`Fear & Greed Index: ${fearGreed.value}/100 — ${fearGreed.classification} (${fearGreed.date})`);
    }

    if (topMarkets?.length) {
      lines.push('');
      lines.push('Top market by market cap:');
      for (const t of topMarkets) {
        const chg  = t.change24h != null ? ` | 24h: ${Number(t.change24h) > 0 ? '+' : ''}${t.change24h}%` : '';
        const mcap = t.mcap ? ` | MCap: $${(t.mcap / 1e9).toFixed(1)}B` : '';
        const px   = t.price != null ? `$${t.price.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : 'N/A';
        lines.push(`  ${t.symbol}: ${px}${chg}${mcap}`);
      }
    }

    if (extraPrice?.price != null) {
      lines.push('');
      const px  = extraPrice.price.toLocaleString('en-US', { maximumFractionDigits: 6 });
      const chg = extraPrice.change24h ? ` | 24h: ${Number(extraPrice.change24h) > 0 ? '+' : ''}${extraPrice.change24h}%` : '';
      lines.push(`${extraPrice.symbol} (harga spesifik): $${px}${chg}`);
    }

    if (isAirdropQuery && airdrops?.length) {
      lines.push('');
      lines.push('Airdrop aktif & claimable (tasks masih open, sorted by raise):');
      for (const a of airdrops) {
        const raise = a.raise > 0 ? ` | Raise: $${(a.raise / 1e6).toFixed(1)}M` : '';
        const sym   = a.symbol && a.symbol !== '?' ? ` (${a.symbol})` : '';
        lines.push(`  - ${a.name}${sym} | Status: ${a.status} | Tasks open: ${a.tasksOpen}/${a.tasksTotal}${raise}`);
      }
    } else if (isAirdropQuery) {
      lines.push('');
      lines.push('Info airdrop: Data airdrop aktif tidak tersedia saat ini dari API.');
    }

    lines.push('');
    lines.push('[Gunakan data di atas untuk menjawab. Harga bersumber dari Surf API real-time.]');

    return lines.join('\n');
  } catch (err) {
    console.warn('[Surf] fetchCryptoContext error:', err.message);
    return null;
  }
}

module.exports = { isCrypto, fetchCryptoContext };
