# CoinMarketCap integration code (excerpt)

These are the server-side files of the Trendline Legends app (Base44 platform) that implement the
Daily Challenge on top of the CoinMarketCap API. They are published as-is for review.

| File | Role |
|---|---|
| `functions/cmcSnapshot/entry.ts` | Scheduled job (00:02 UTC): collects CMC data (Pro API with keyless fallback, retries and logging), resolves yesterday's questions, pays XP, creates today's questions and the tutor's reading |
| `functions/responderDesafio/entry.ts` | Receives a player's answer: validates confidence (55–95%) and answer window on the server, atomic one-answer lock |
| `functions/obterDesafios/entry.ts` | Returns the questions each player can see (featured BTC question + metrics from lessons the player studied) |
| `functions/obterDemo/entry.ts` | Public read-only data for the judge demo at https://trendline365.com/demo |
| `shared/desafio.ts` | Brier scoring, question text, tutor prompts and explanations |

Notes
- The CMC API key is read from the server secret `CMC_API_KEY`; it is not in this repository.
- Other app modules imported by these files (lesson progression, catalogue, notifications) are part of the
  full app and are not included in this excerpt; the full app runs at https://trendline365.com.
