#!/usr/bin/env python3
"""Trendline Legends - offline replay.

Recomputes every number the app publishes from saved CoinMarketCap values,
with no API key, no network and no dependencies (Python 3.8+ stdlib only).

    python3 replay/replay.py                      # uses the files in evidence/live/
    python3 replay/replay.py path/to/obterDemo.json path/to/obterEvidencias.json path/to/obterLedger.json

What it checks
1. Scoring rule: rebuilds the XP table from XP = round(40 - 44*(p-o)^2) + early bonus.
2. Resolved example: re-derives the outcome (above/below) from the reference and
   closing CoinMarketCap values, the tutor's Brier score and the published XP.
3. Tutor scoreboard: shows the tutor's Brier against the coin-flip baseline (0.25)
   and states whether the circuit breaker (confidence locked at 55%) must be on.
4. API call log: counts calls, HTTP statuses, credits and source (pro / keyless).
5. Full forecast ledger: re-derives every resolved outcome and recomputes the
   tutor's hit rate and Brier from scratch, plus its side bias.
Exit code 0 = every check passed; 1 = a published number does not match.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.join(HERE, "..", "evidence", "live")
DEFAULT_DEMO = os.path.join(LIVE, "obterDemo-2026-11-24T0015Z.json")
DEFAULT_LOG = os.path.join(LIVE, "obterEvidencias-2026-11-24T0015Z.json")
DEFAULT_LEDGER = os.path.join(LIVE, "obterLedger-2026-11-24T0049Z.json")

COIN_FLIP_BRIER = 0.25
EARLY_BONUS = 2

failures = []
EN = {"acima": "above", "abaixo": "below"}


def check(label, ok, detail=""):
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def brier(p_side, right):
    """Brier score of a binary forecast: p = confidence in the chosen side."""
    o = 1.0 if right else 0.0
    return (p_side - o) ** 2


def xp(p_side, right, early):
    o = 1.0 if right else 0.0
    return round(40 - 44 * (p_side - o) ** 2) + (EARLY_BONUS if early else 0)


def outcome(reference, close):
    return "acima" if close > reference else "abaixo"


def main():
    demo_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DEMO
    log_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_LOG
    demo = json.load(open(demo_path, encoding="utf-8"))
    log = json.load(open(log_path, encoding="utf-8"))
    ledger_path = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_LEDGER
    ledger = json.load(open(ledger_path, encoding="utf-8")) if os.path.exists(ledger_path) else None

    print("1. Scoring rule (proper Brier, affine transform)")
    expected = {(0.55, True): 31, (0.75, True): 37, (0.95, True): 40,
                (0.55, False): 27, (0.75, False): 15, (0.95, False): 0}
    for (p, right), published in expected.items():
        got = xp(p, right, early=False)
        check(f"{int(p*100)}% {'right' if right else 'wrong'} = {published} XP", got == published, f"replay {got}")
    # Honesty pays: expected XP is maximised by reporting the true belief.
    belief = 0.6
    ev = {p: belief * xp(p, True, False) + (1 - belief) * xp(p, False, False) for p in (0.55, 0.6, 0.75, 0.95)}
    best = max(ev, key=ev.get)
    check("with a true belief of 60%, reporting 55-60% beats 95%", ev[best] >= ev[0.95] and best <= 0.6,
          ", ".join(f"{int(p*100)}%: {v:.1f}" for p, v in ev.items()))

    print("\n2. Resolved question, re-derived from CoinMarketCap values")
    ex = demo["exemplo"]
    res = outcome(ex["valor_referencia"], ex["valor_fechamento"])
    print(f"  {ex['pergunta_en']}")
    print(f"  reference {ex['valor_referencia']:,.0f} at {ex['horario_referencia']}")
    print(f"  close     {ex['valor_fechamento']:,.0f} at {ex['horario_fechamento']}")
    check("outcome matches the published result", res == ex["resultado"], f"replay '{EN[res]}', published '{EN[ex['resultado']]}'")
    tutor_right = ex["previsao_tutor_lado"] == res
    b = brier(ex["previsao_tutor_confianca"], tutor_right)
    print(f"  tutor said '{EN[ex['previsao_tutor_lado']]}' at {ex['previsao_tutor_confianca']:.0%} -> "
          f"{'right' if tutor_right else 'wrong'}, Brier {b:.4f}")
    if "xp_exemplo" in ex:
        # The demo example is a player who answered the right side at 60% in the first 3 hours.
        check("example XP (right, 60%, early) = published", xp(0.60, True, True) == ex["xp_exemplo"],
              f"replay {xp(0.60, True, True)}, published {ex['xp_exemplo']}")

    print("\n3. Tutor scoreboard vs coin flip")
    t = demo["placar"]["tutor"]
    hits = round(t["taxa"] * t["respostas"])
    print(f"  {t['respostas']} resolved answers, {hits} right ({t['taxa']:.0%}), mean Brier {t['brier']:.3f}")
    print(f"  coin flip (always 50%) = {COIN_FLIP_BRIER:.3f}")
    worse = t["brier"] > COIN_FLIP_BRIER
    print(f"  verdict: tutor is {'WORSE' if worse else 'better'} than a coin flip -> "
          f"circuit breaker {'ON (confidence locked at 55%)' if worse else 'off'}")
    check("hit count is an integer consistent with the rate", abs(hits / t["respostas"] - t["taxa"]) < 1e-9)
    # Lower bound: with h hits out of n at >=55% confidence, Brier cannot be below this.
    floor = (hits * brier(0.55, True) + (t["respostas"] - hits) * brier(0.55, False)) / t["respostas"]
    check("published Brier is not better than the 55%-everywhere floor", t["brier"] >= floor - 1e-9,
          f"floor {floor:.3f}")

    print("\n4. CoinMarketCap API call log")
    calls = log["chamadas"]
    by_round = {}
    for c in calls:
        by_round.setdefault(c["rodada"], []).append(c)
    for rnd, cs in sorted(by_round.items()):
        credits = sum(c.get("credit_count") or 0 for c in cs)
        srcs = sorted({c["fonte"] for c in cs})
        statuses = sorted({c["http_status"] for c in cs})
        print(f"  round {rnd}: {len(cs)} calls, HTTP {statuses}, {credits} credits, source {srcs}")
    check("every logged call returned HTTP 200", all(c["http_status"] == 200 for c in calls))
    check("no keyless fallback in the log", all(c["fonte"] == "pro" for c in calls))
    check("a full daily round costs 3 credits",
          all(sum(c.get("credit_count") or 0 for c in cs) == 3 for cs in by_round.values()))

    snap = demo["snapshot"]["metricas"]
    print("\n  last snapshot (source: %s)" % demo["snapshot"]["fonte"])
    for k, v in snap.items():
        print(f"    {k:<18} {v['valor']:>22,.2f}   last_updated {v['last_updated']}")

    if ledger:
        print("\n5. Full forecast ledger (every resolved question)")
        qs = ledger["perguntas"]
        wrong_outcome = [q for q in qs if outcome(q["valor_referencia"], q["valor_fechamento"]) != q["resultado"]]
        check(f"all {len(qs)} outcomes re-derived from CMC values match", not wrong_outcome,
              f"{len(wrong_outcome)} mismatches")
        right = [q["previsao_tutor_lado"] == outcome(q["valor_referencia"], q["valor_fechamento"]) for q in qs]
        scores = [brier(q["previsao_tutor_confianca"], r) for q, r in zip(qs, right)]
        mean_b = sum(scores) / len(scores)
        pub = ledger["placar"]["tutor"]
        check("tutor hits recomputed = published", sum(right) == pub["acertos"], f"{sum(right)}/{len(qs)}")
        check("tutor Brier recomputed = published", abs(mean_b - pub["brier"]) < 1e-9, f"{mean_b:.4f}")
        check("ledger scoreboard = demo scoreboard", abs(pub["brier"] - demo["placar"]["tutor"]["brier"]) < 1e-9)
        below_calls = sum(q["previsao_tutor_lado"] == "abaixo" for q in qs)
        below_outcomes = sum(q["resultado"] == "abaixo" for q in qs)
        print(f"  side bias: tutor said 'below' {below_calls}/{len(qs)} times; market closed below {below_outcomes}/{len(qs)}")
        by_round = {}
        for q, r, b in zip(qs, right, scores):
            by_round.setdefault(q["rodada"], []).append((r, b))
        for rnd, v in sorted(by_round.items()):
            print(f"    round {rnd}: {sum(r for r, _ in v)}/{len(v)} right, Brier {sum(b for _, b in v)/len(v):.3f}")

    print("\nResult:", "ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED: {failures}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
