# Trendline Legends — learn crypto markets by forecasting with live CoinMarketCap data

**Live app:** https://trendline365.com · **Judge demo (no login):** https://trendline365.com/demo
**Track:** AI Agents and Automation · **Hackathon:** Build with CMC (DoraHacks, Nov–Dec 2026)

Trendline Legends is a bilingual (Portuguese/English) learning game for crypto traders and investors.
It has **500 text lessons in 7 realms** — from reading a candle to derivatives, tokenization, portfolio
management and historical crashes. Every lesson is tied to a **CoinMarketCap endpoint**, and every day the
app turns that data into a **Daily Challenge**: a binary forecast question that is resolved the next day
with real CMC data.

Students answer *above / below* and choose a **confidence (55–95%)**. An AI tutor writes a neutral
reading of the market before the question opens and explains the result after it resolves.
XP is paid with a **proper scoring rule (Brier)**, so the only way to earn more over time is to be
**right and honestly calibrated** — overconfident guessing loses.

---

## Why this needs more than one API call

A single call to `/quotes/latest` gives you a price. Trendline Legends runs a daily, unattended loop on top of it:

1. **Snapshot** (00:02 UTC, scheduled job): collects BTC/ETH quotes, global metrics and Fear & Greed
   from CoinMarketCap, with batching, retries and logging.
2. **Question generation**: one question per metric per day (BTC price, ETH price, BTC 24h volume,
   total market cap, BTC dominance), each linked to the lesson that teaches it.
3. **AI tutor reading**: for each question the agent writes one argument for *above* and one for *below*,
   using the snapshot numbers (volume, 24h change, Fear & Greed), without revealing a side. The agent also
   records its own forecast and confidence.
4. **Answer window**: 00:00–12:00 UTC (21:00–09:00 Brasília). The server rejects answers after the window,
   which always closes **12 h before** the reference close.
5. **Resolution** (next 00:00 UTC snapshot): compares the new CMC value with the reference value,
   scores every answer, explains the outcome and updates XP, streaks and the 30-day **accuracy ranking**.
6. **Calibration tracking**: players and the tutor agent are compared on hit rate and Brier score.

## Scoring (proper Brier rule)

```
XP = round(40 − 44 × (p − o)²) + 2 if answered in the first 3 hours
p = confidence (0.55 … 0.95), o = 1 if right, 0 if wrong
```

| XP | 55% | 75% | 95% |
|---|---|---|---|
| Right | 31 | 37 | 40 |
| Wrong | 27 | 15 | 0 |

Because the score is an affine transform of the Brier score, reporting your true belief maximises
expected XP. A player who always clicks 95% on coin flips earns less than an honest 55% player.
The public ranking uses the mean Brier score over the last 30 days (minimum 5 resolved answers), and
paid plans have **no influence** on scores or ranking.

## CoinMarketCap endpoints used

| Endpoint | Used for |
|---|---|
| `/v3/cryptocurrency/quotes/latest?id=1,1027&convert=USD` | BTC and ETH price, 24h change, 24h volume |
| `/v1/global-metrics/quotes/latest?convert=USD` | Total market cap, BTC dominance |
| `/v3/fear-and-greed/latest` | Market sentiment for the tutor's reading |
| `/v3/fear-and-greed/historical`, `/v3/cryptocurrency/quotes/historical`, `/v2/cryptocurrency/ohlcv/historical`, `/v1/cryptocurrency/categories`, `/v5/derivatives/...` | Taught in lessons ("The CoinMarketCap data" section of each lesson) |

## Evidence of real API calls

- [`evidence/cmc-dashboard-request.md`](evidence/cmc-dashboard-request.md) — request log from the CMC developer
  dashboard: `GET /v3/cryptocurrency/quotes/latest?id=1&convert=USD`, **HTTP 200**, 1 credit, 23 Nov 2026.
- [`evidence/snapshot-sample.json`](evidence/snapshot-sample.json) — values read in a real Pro API collection
  on 23 Nov 2026 (16:32 UTC).
- The `/demo` page shows the last live snapshot, the endpoints called and the questions open today.

## Architecture

- **Front end and backend:** built on Base44 (React front end + server functions + scheduled workflow).
- **Server functions:** `cmcSnapshot` (collection, questions, resolution, XP), `responderDesafio` (answer
  with server-side validation and atomic lock), `obterDesafios` (questions visible to each player),
  `obterDemo` (public read-only demo).
- **API key:** stored as a server secret (`CMC_API_KEY`); never sent to the browser. If the Pro call fails,
  the job retries (30 s, 2 min, 5 min) and falls back to CMC's keyless endpoint, logging every failure.
- **Idempotency:** one snapshot lock per round, unique question per round + metric, XP paid only once.

See [`docs/how-it-works.md`](docs/how-it-works.md) for the full daily cycle.

## What the CMC API made possible — and where it got in the way

**Made possible**
- One batched call (`id=1,1027`) gives everything the BTC/ETH questions need; global metrics and
  Fear & Greed add context for the tutor, so a full daily round costs **3 credits**.
- `last_updated` timestamps let us show exactly which data point resolved each question.
- Fear & Greed turned out to be the most useful input for the tutor's neutral "for above / for below"
  reasoning.

**Got in the way**
- The keyless endpoint returned **HTTP 429** during our first automatic round (21 Nov 2026); we added
  batching, retries with backoff and a fallback path, and moved to an API key.
- `v3/quotes/latest` returns `quote` as a list (`[{symbol: "USD", price, …}]`) while other versions use
  `quote.USD`; our parser accepts both.
- Several endpoints we wanted to teach (market pairs, exchange listings, blockchain statistics) require
  Growth or Enterprise plans; those lessons say so explicitly.

## Responsible design

- Educational only: no investment advice, no signals, no real-money prizes, no betting.
- Lessons on crises include psychology, pausing and where to seek support.
- All examples in lessons use fictional values; dated facts were verified.

## Content

- 500 lessons (PT/EN), each with 3 original SVG figures, a 5-question quiz and a "CoinMarketCap data" section.
- 7 realms: Candle Village (70), Spot Plains (75), Trend Valley (80), Derivatives Fortress (70),
  Tokenization Isles (75), Fund Citadel (70), Tower of Chaos (60).

## License

MIT — see [LICENSE](LICENSE).
