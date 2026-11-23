# CoinMarketCap developer dashboard — request log

Captured from https://coinmarketcap.com/api/dashboard/ ("Last 100 Standard API Requests"), 23 Nov 2026.

| Request | Label | API key | Timestamp | Credits | Result |
|---|---|---|---|---|---|
| `/v3/cryptocurrency/quotes/latest?id=1&convert=USD` | Default | `****b482` (masked by CMC) | 23 Nov 2026, 1:30:59 PM (UTC-3) | 1 | HTTP 200 |

The request was made by the app's server function using the `CMC_API_KEY` secret (header
`X-CMC_PRO_API_KEY`). The key itself is never stored in this repository.
