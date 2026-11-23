# How the Daily Challenge works

| Time (UTC) | Time (Brasília) | Step |
|---|---|---|
| 00:02 | 21:02 | Scheduled job `cmcSnapshot` runs: collects CMC data, resolves yesterday's questions, pays XP, creates today's questions and the tutor's reading |
| 00:00–03:00 | 21:00–00:00 | Early answers get +2 XP |
| 12:00 | 09:00 | Answers close (always 12 h before the reference close) |
| 00:00 next day | 21:00 | Reference close; resolved at 00:02 by the next run |

## Question format

"At 00:00 UTC tomorrow, will BTC close above or below US$ 61,055?" — the reference value is the
CMC value captured in the snapshot. Ties count as "below". Two decimal places.

## Data flow

1. `GET /v3/cryptocurrency/quotes/latest?id=1,1027&convert=USD`
2. `GET /v1/global-metrics/quotes/latest?convert=USD`
3. `GET /v3/fear-and-greed/latest`
4. Snapshot saved with `last_updated` per metric and the source used (pro or keyless).
5. One question per metric; the tutor agent writes arguments for both sides and its own forecast.
6. Next run: compare, score with the Brier rule, explain, update XP, streak and ranking.

## Safeguards

- Server-side validation of confidence (55–95%) and answer window.
- Atomic lock: one answer per player per question; one snapshot per round.
- Retries on 429/5xx with backoff; keyless fallback; every failure written to the admin log.
- API key kept as a server secret.
