# Agent Instructions

## Surf routing (primary crypto data source)

For **any** crypto data query, **always fetch fresh data with `surf` first** — never rely on training knowledge for prices, on-chain data, or market conditions. Surf has 90+ commands across 12 domains, 40+ chains, 200+ data sources.

CLI binary: `~/.local/bin/surf` — always prefix with `export PATH="$HOME/.local/bin:$PATH" &&`
API key: configured in `~/.surf/config.json` (set via `SURF_API_KEY` env var)
Always run `surf sync` at the start of a fresh session before querying.

### Workflow

1. Map the query to a domain using the table below
2. Run `surf list-operations | grep <domain>` to see available endpoints
3. Run `surf <command> --help` to read exact flags — **never guess flags from another command**
4. Execute the command

---

## Command Reference (90+ commands)

### Exchange — CEX live market data
```
exchange-price          Live ticker price       --pair, --type, --exchange
exchange-klines         OHLCV candlesticks      --pair, --interval, --from, --limit
exchange-depth          Order book snapshot     --pair, --type, --limit
exchange-perp           Perp contract snapshot  --pair, --exchange
exchange-funding-history Funding rate history   --pair, --from, --limit
exchange-long-short-ratio L/S ratio history     --pair, --interval, --from
exchange-markets        All trading pairs       --exchange, --type, --base, --quote
listing                 New listing events      --from, --to, --symbol, --exchange
```

### Market — aggregated indicators & rankings
```
market-price            Token price history     --symbol, --time-range, --from, --to
market-ranking          Token rankings          --sort-by, --order, --category, --limit
market-fear-greed       Fear & Greed Index      --from, --to
market-futures          Futures overview        --sort-by, --order
market-options          Options data            --symbol, --sort-by
market-etf              ETF flow history        --symbol, --from, --to
market-liquidation-order  Large liquidations    --symbol, --min-amount, --side
market-liquidation-chart  Liquidation chart     --symbol, --interval
market-liquidation-exchange-list  By exchange   --symbol, --time-range
market-onchain-indicator  On-chain metrics      --symbol, --metric (nupl/sopr/mvrv/puell-multiple)
market-price-indicator  Technical indicator     --indicator (rsi/macd/bbands), --symbol, --interval
market-public-sale      Public sale / IDO       --id, --q
market-tge              Token Generation Event  --id, --q
```
Note: `market-onchain-indicator` uses `--metric`, not `--indicator`. NUPL/MVRV/SOPR/Puell only work for BTC.

### Wallet — multi-chain analytics
```
wallet-detail           Holdings across chains  --address, --chain, --fields
wallet-history          Transaction history     --address, --chain, --limit, --include
wallet-transfers        Transfer history        --address, --chain, --flow, --token
wallet-protocols        DeFi positions          --address, --limit
wallet-net-worth        Net worth history       --address
wallet-labels-batch     Known wallet labels     --addresses
```
Tip: add `--include labels` to wallet-history/wallet-transfers to get entity names (exchange, fund, whale, etc.)

### Token — on-chain token activity
```
token-holders           Top holders             --address, --chain, --limit, --include
token-dex-trades        DEX swap history        --address, --chain, --limit
token-transfers         Transfer history        --address, --chain, --from, --to
token-tokenomics        Unlock schedule         --id, --symbol, --from, --to
```

### Project — DeFi protocols
```
project-detail          Project profile         --id, --q, --handle, --fields
project-defi-metrics    TVL, fees, revenue      --id, --q, --metric, --chain
project-defi-ranking    Protocol rankings       --metric, --limit
project-ai-news         AI news for project     --id, --q
```

### Social — Twitter/X & mindshare
```
social-user             Profile                 --handle
social-user-posts       Posts                   --handle, --filter
social-user-followers   Followers list          --handle, --limit
social-ranking          Mindshare rankings      --tag, --time-range, --sentiment
social-mindshare        Mindshare time series   --id, --q, --interval
social-sentiment        Sentiment score         --id, --q
social-detail           Full social analytics   --x-id, --q, --fields
social-engagement-score Engagement score        --handle
social-smart-followers-history Smart followers  --x-id, --q
social-tweets           Posts by IDs            --ids
social-tweet-replies    Tweet replies           --tweet-id
```

### Airdrop — airdrop hunting & tracking (KEY USE CASE)
```
search-airdrop          Search airdrops         --q, --phase, --reward-type, --task-type, --has-open, --include-tasks, --sort-by
search-airdrop-activities  Latest activities    --limit, --offset
```
Phase values: `active` (POTENTIAL+CONFIRMED, tasks open), `claimable` (SNAPSHOT+VERIFICATION+REWARD_AVAILABLE), `completed` (DISTRIBUTED)
Task types: social, testnet, mainnet, staking, trading, liquidity, mint-nft, game, depin, node, ambassador, predictions
Sort by: `total_raise`, `xscore`, `last_status_update`

Example — find open testnet airdrops sorted by raise:
```bash
export PATH="$HOME/.local/bin:$PATH"
surf search-airdrop --phase active --task-type testnet --has-open --sort-by total_raise --include-tasks --limit 20
```

### Prediction Markets — Polymarket & Kalshi
```
polymarket-markets      Market list             --market-slug, --limit
polymarket-trades       Trade history           --condition-id, --min-amount, --from
polymarket-prices       Price history           --condition-id, --time-range
polymarket-smart-money  Smart money flow        --condition-id, --view, --direction
polymarket-leaderboard  Trader PnL leaderboard  --sort-by, --limit
polymarket-positions    Wallet positions        --address
polymarket-volumes      Volume history          --condition-id, --time-range
polymarket-events       Event metadata          --event-slug
polymarket-price-ohlcv  OHLCV candles          <condition_id> --interval
polymarket-volume-split YES/NO volume split     <condition_id> --granularity
polymarket-open-interest OI history            --condition-id
polymarket-orderbooks   Orderbook history       --token-id

kalshi-markets          Market list             --market-ticker
kalshi-trades           Trade fills             --ticker, --from, --to
kalshi-prices           Price history           --ticker, --time-range
kalshi-volumes          Volume history          --ticker
kalshi-open-interest    OI history              --ticker
kalshi-events           Event metadata          --event-ticker
kalshi-orderbooks       Orderbook history       --ticker

matching-market-pairs   Cross-platform match    --category, --active-only, --min-confidence
matching-market-daily   Daily comparison        --polymarket-condition-id, --kalshi-market-ticker
prediction-market-analytics  Analytics          --category, --platform, --time-range
prediction-market-correlations  Correlations   --category, --condition-id
```

### On-Chain SQL — raw ClickHouse queries (84 tables)
```
onchain-sql             Execute SQL             pipe JSON: echo '{"query":"SELECT ..."}' | surf onchain-sql
onchain-structured-query No-SQL query           POST with JSON
onchain-schema          List all tables         (no flags needed)
onchain-tx              Transaction lookup      --hash, --chain, --include
onchain-gas-price       Current gas prices      --chain
onchain-bridge-ranking  Bridge rankings         --time-range, --limit
onchain-yield-ranking   DeFi yield ranking      --project, --sort-by, --limit
```

**ClickHouse SQL rules:**
- Always prefix tables with `agent.` (e.g., `agent.ethereum_dex_trades`)
- Always filter on `block_date` first (partition key — without it, full table scan)
- Use `FINAL` for ReplacingMergeTree tables (Hyperliquid, some curated views)
- `amount_usd` in DEX trades is one-sided (token_sold) — multiply by 2 for two-sided volume
- Chain names: `ethereum`, `solana`, `polygon`, `bsc`, `arbitrum`, `optimism`, `base`, `avalanche`

**Key tables:**
```
agent.ethereum_dex_trades          DEX swaps on Ethereum
agent.base_dex_trades              DEX swaps on Base
agent.arbitrum_dex_trades          DEX swaps on Arbitrum
agent.bsc_dex_trades               DEX swaps on BSC (4B rows, always filter date!)
agent.ethereum_transfers           ERC-20 + native transfers
agent.ethereum_prices_day          Daily token prices (CoinGecko + DEX VWAP)
agent.ethereum_tvl_daily           Protocol TVL by day
agent.ethereum_fees_daily          Protocol fee revenue
agent.ethereum_yields_daily        Pool APY data
agent.ethereum_lending_daily       Lending protocol flows (Aave, Compound, etc.)
agent.ethereum_staking_daily       Beacon chain staking by entity
agent.hyperliquid_market_data      Perp snapshots (use FINAL)
agent.hyperliquid_funding_rates    Funding rates (use FINAL)
agent.polymarket_market_details    Polymarket market metadata
agent.polymarket_trades            All trades (934M rows, always filter!)
agent.polymarket_smart_money_wallets  Smart money addresses
agent.kalshi_trades                Kalshi trades (use FINAL)
curated.polymarket_hot_markets     Top markets (VIEW, always current)
curated.polymarket_whale_trades    Large trades with wallet enrichment
agent.prediction_markets_daily     Unified Polymarket+Kalshi daily volume/OI
```

### Search & Discovery
```
search-project          Project search          --q, --limit
search-wallet           Wallet search           --q
search-news             News full-text          --q, --limit
search-social-people    Twitter user search     --q
search-social-posts     Twitter post search     --q
search-fund             VC fund search          --q
search-prediction-market  Prediction market     --q, --platform, --status
search-events           Project events          --q, --type
web-fetch               Fetch any URL           --url
search-web              Web search              --q, --limit
```

### News
```
news-feed               Latest articles         --source, --project, --from, --to
news-detail             Full article            --id
```
Tip: for event-based news (exchange listings, hacks, regulatory moves), use `search-news --q` instead of `news-feed --project` — it's full-text across all 17 sources.

### Fund / VC
```
fund-detail             Fund profile            --id, --q
fund-portfolio          Fund holdings           --id, --q, --sort-by
fund-ranking            Rankings by AUM         --metric, --limit
```

---

## Chat Completions API (surf-1.5)

OpenAI-compatible endpoint for AI-synthesized crypto answers with live data and citations.
```
POST https://api.asksurf.ai/gateway/v1/chat/completions
Authorization: Bearer $SURF_API_KEY
```
Models: `surf-1.5` (adaptive), `surf-1.5-thinking` (deep reasoning), `surf-1.5-instant` (fast)
Use `reasoning_effort: "high"` for complex analysis. Stream supported.

---

## Data API Direct (without CLI)

Base URL: `https://api.asksurf.ai/gateway/v1`
Auth: `Authorization: Bearer $SURF_API_KEY`
Rate limit: 100 req/min per key
Credits returned in `meta.credits_used` on every response.

---

## Gotchas

- Flags are **kebab-case** (`--sort-by`, `--token-address`). Copy from `--help`, never guess.
- Chain names are **long-form only**: `ethereum` not `eth`, `solana` not `sol`, `polygon` not `matic`
- `--q` (double dash) for search. `-q` is a global flag — don't confuse them.
- POST endpoints (`onchain-sql`, `onchain-structured-query`) take JSON on stdin: `echo '{"query":"..."}' | surf onchain-sql`
- Enum values are always lowercase: `--indicator rsi` not `RSI`
- `market-onchain-indicator` uses `--metric nupl`, not `--indicator nupl`
- `news-feed --project` filters by tag — use `search-news --q` for event-based queries
- Kalshi tables use ReplacingMergeTree — always add `FINAL` keyword
- Polymarket OI is sparse — use `argMax(open_interest_usd, block_date)` to get latest
