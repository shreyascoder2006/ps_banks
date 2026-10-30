"""Retention experiment report: treatment vs holdout.

Counting rules (documented in the response):
  - one row per (customer, campaign): the latest action wins, so a customer is
    never counted twice;
  - only observed outcomes count - simulated outcomes are excluded;
  - retention rate = retained / (retained + churned); `no_response` is reported
    separately and excluded from the rate;
  - an action with no outcome is `pending` (window still open) or `missing`
    (window closed with no outcome recorded).
Uncertainty: Wilson 95% interval per group; Newcombe hybrid-score interval for
the absolute difference. Treatment/holdout are assigned by a deterministic hash,
not by customer need, but customers were not randomised by a clinical protocol:
treat results as indicative, not causal proof.
"""
import math
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ...models import OutreachAction, OutreachOutcome
from ..churn import score_all_customers

Z = 1.96
MIN_GROUP_N = 30


def wilson(k: int, n: int, z: float = Z) -> Optional[tuple[float, float]]:
    if n == 0:
        return None
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, centre - half), min(1.0, centre + half)


def newcombe_diff(k1: int, n1: int, k2: int, n2: int) -> Optional[tuple[float, float, float]]:
    """Difference p1 - p2 with Newcombe's hybrid score interval."""
    if n1 == 0 or n2 == 0:
        return None
    p1, p2 = k1 / n1, k2 / n2
    l1, u1 = wilson(k1, n1)
    l2, u2 = wilson(k2, n2)
    diff = p1 - p2
    return diff, diff - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), diff + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)


def _group_stats(rows: list[dict]) -> dict:
    retained = sum(r["outcome"] == "retained" for r in rows)
    churned = sum(r["outcome"] == "churned" for r in rows)
    no_resp = sum(r["outcome"] == "no_response" for r in rows)
    pending = sum(r["state"] == "pending" for r in rows)
    missing = sum(r["state"] == "missing" for r in rows)
    n = retained + churned
    ci = wilson(retained, n)
    return {"assigned": len(rows), "measured": n, "retained": retained, "churned": churned, "noResponse": no_resp,
            "pending": pending, "missingAfterWindow": missing,
            "retentionRate": round(retained / n, 4) if n else None,
            "ci95": [round(ci[0], 4), round(ci[1], 4)] if ci else None}


def build_report(session: Session, campaign: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    now = now or datetime.utcnow()
    actions = list(session.exec(select(OutreachAction)).all())
    if campaign:
        actions = [a for a in actions if a.campaign == campaign]
    # Only deliberate experiment records: treatment actions that were delivered/executed and holdout (withheld).
    actions = [a for a in actions if a.status in ("delivered", "executed", "withheld")]
    latest: dict[tuple, OutreachAction] = {}
    for a in sorted(actions, key=lambda x: x.created_at):
        latest[(a.customer_id, a.campaign)] = a
    outcomes = {o.action_id: o for o in session.exec(select(OutreachOutcome)).all()}
    scored = score_all_customers().set_index("CustomerId")

    rows, simulated_excluded = [], 0
    for a in latest.values():
        o = outcomes.get(a.id)
        if o and not o.observed:
            simulated_excluded += 1
            o = None
        window_end = a.created_at + timedelta(days=a.observation_days)
        state = "recorded" if o else ("pending" if now < window_end else "missing")
        rows.append({"group": a.experiment_group, "channel": a.channel, "campaign": a.campaign,
                     "segment": scored.loc[a.customer_id, "segment"] if a.customer_id in scored.index else "unknown",
                     "outcome": o.outcome if o else None, "state": state, "early": bool(o and o.created_at < window_end),
                     "simulatedDelivery": a.simulated})

    treat = [r for r in rows if r["group"] == "treatment"]
    hold = [r for r in rows if r["group"] == "holdout"]
    ts, hs = _group_stats(treat), _group_stats(hold)

    comparison = {"computable": False, "reason": None}
    if ts["measured"] and hs["measured"]:
        d = newcombe_diff(ts["retained"], ts["measured"], hs["retained"], hs["measured"])
        comparison = {
            "computable": True, "absoluteDifferencePts": round(d[0] * 100, 1),
            "ci95Pts": [round(d[1] * 100, 1), round(d[2] * 100, 1)],
            "relativeDifferencePct": round(d[0] / hs["retentionRate"] * 100, 1) if hs["retentionRate"] else None,
            "interpretation": "interval includes 0 - no evidence of an effect" if d[1] <= 0 <= d[2] else "interval excludes 0",
        }
    else:
        comparison["reason"] = "Need at least one measured outcome in BOTH treatment and holdout groups."
    adequate = ts["measured"] >= MIN_GROUP_N and hs["measured"] >= MIN_GROUP_N

    def breakdown(key: str) -> dict:
        buckets = defaultdict(list)
        for r in treat:
            buckets[r[key]].append(r)
        return {k: _group_stats(v) for k, v in sorted(buckets.items())}

    return {
        "generatedAt": now.isoformat() + "Z", "campaign": campaign or "all",
        "treatment": ts, "holdout": hs, "comparison": comparison,
        "sampleAdequate": adequate, "minGroupSize": MIN_GROUP_N,
        "byChannel": breakdown("channel"), "bySegment": breakdown("segment"), "byCampaign": breakdown("campaign"),
        "excludedSimulatedOutcomes": simulated_excluded,
        "simulatedDeliveries": sum(r["simulatedDelivery"] for r in treat),
        "methodology": {
            "dedupe": "latest action per (customer, campaign)", "rate": "retained / (retained + churned); no_response reported separately",
            "missing": "window closed with no outcome recorded - reported, never imputed",
            "conflicts": "latest recorded outcome replaces earlier ones; changes are audited",
            "assignment": "deterministic hash of campaign+customer; holdout customers are deliberately not contacted",
        },
        "limitations": [
            "Delivery is simulated in this demo; outcomes reflect what was recorded, not real customer behaviour unless entered as observed.",
            f"Groups need >= {MIN_GROUP_N} measured outcomes each before any difference should be read as meaningful.",
            "Not a randomised controlled trial; selection and recording bias are possible.",
        ] + ([] if adequate else ["Current sample is below the minimum - treat every number here as illustrative."]),
    }
