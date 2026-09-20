"""Live demo simulator.

Generates a realistic stream of bank events on a timer so the console
visibly runs during a presentation: complaints arriving over channels,
customers going quiet (activity drop -> risk rises), balances moving,
outreach outcomes coming back, customer follow-ups, SLA warnings. Every
mutation goes through the same services real actions use, so the data
it creates is indistinguishable from manual use - and every record it
writes is tagged `source="simulator"` where the schema allows.

It is opt-in (POST /simulation/start), off by default, and fully stoppable.
"""
import asyncio
import random
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import select

from ..db import session_scope
from ..models import Complaint, ComplaintMessage, CustomerSignal, OutreachAction, OutreachOutcome
from .churn import score_all_customers
from .complaint_insights import create_complaint
from .events import publish
from .outreach import record_outcome

_task: Optional[asyncio.Task] = None
_state = {"running": False, "ticks": 0, "started_at": None, "speed": 1.0, "last_event": None}
_warned_sla: set[str] = set()

COMPLAINT_TEMPLATES = [
    ("whatsapp", "Card blocked without notice", "My debit card was blocked while paying at a hospital. No SMS, no call. I need it unblocked today."),
    ("ivr", "EMI auto-debit failed", "The home loan EMI auto-debit bounced even though there was sufficient balance and now I am being charged a penalty."),
    ("portal", "UPI payment stuck in processing", "Paid Rs 8,500 to a merchant via UPI, money debited but merchant says not received. It has been 3 days."),
    ("email", "Unauthorized international transaction", "There is a USD 240 charge on my credit card from a site I have never used. Please reverse it and block the card."),
    ("branch", "Locker access denied", "Branch staff refused locker access saying my KYC is pending, but I updated KYC last month."),
    ("whatsapp", "Cheque book not delivered", "Requested a cheque book 20 days ago, courier says delivered but I never received it."),
    ("portal", "Wrong interest credited on FD", "My FD matured last week and the interest credited is lower than the rate promised at booking."),
    ("email", "Net banking OTP not arriving", "OTP for net banking login never arrives on my registered number. I cannot pay my bills."),
    ("ivr", "Duplicate charges on credit card", "I was charged twice for the same fuel transaction of Rs 3,200. Need a refund."),
    ("branch", "Relationship manager unreachable", "My RM has not responded to calls or emails for two weeks regarding my investment query. Considering moving my portfolio."),
]

FOLLOW_UPS = [
    "Any update on this? It has been a while.",
    "I am still waiting for a resolution. Please escalate.",
    "If this is not resolved by tomorrow I will approach the banking ombudsman.",
    "Can someone call me back today?",
    "Thank you for the response, but the issue is still not fixed.",
]


def _rand_customer(level_filter=None):
    df = score_all_customers()
    if level_filter:
        df = df[df["churn_risk_level"].isin(level_filter)]
    return df.sample(1).iloc[0]


def _tick_new_complaint():
    row = _rand_customer(["critical", "high", "medium"])
    channel, subject, body = random.choice(COMPLAINT_TEMPLATES)
    with session_scope() as session:
        result = create_complaint(session, int(row["CustomerId"]), subject, body, channel)
    c = result["complaint"]
    publish(
        "complaint_logged",
        f"New {c['severity']} complaint via {channel}: {c['customerName']} - {subject}",
        severity=c["severity"],
        ref={"complaintId": c["id"], "customerId": c["customerId"]},
        data={"complaint": c, "related": result["related"]},
    )


def _tick_activity_drop():
    df = score_all_customers()
    active = df[(df["Is Active Member"] == 1) & (df["churn_risk_level"].isin(["medium", "high"]))]
    if active.empty:
        return
    row = active.sample(1).iloc[0]
    cid = int(row["CustomerId"])
    old = float(row["churn_risk_score"])
    with session_scope() as session:
        sig = session.get(CustomerSignal, cid) or CustomerSignal(customer_id=cid)
        sig.is_active_member = 0
        sig.source = "simulator"
        sig.note = "No login / transaction in 30 days"
        sig.updated_at = datetime.utcnow()
        session.add(sig)
        session.commit()
    new = float(score_all_customers().set_index("CustomerId").loc[cid, "churn_risk_score"])
    publish(
        "risk_changed",
        f"{row['Surname']} ({row['branch']}) went quiet - risk {old:.0f}% -> {new:.0f}%",
        severity="high" if new >= 50 else "medium",
        ref={"customerId": cid, "branch": row["branch"]},
        data={"old": old, "new": new, "reason": "activity drop-off"},
    )


def _tick_balance_move():
    row = _rand_customer(["high", "critical"])
    cid = int(row["CustomerId"])
    old_bal = float(row["Balance"])
    factor = random.choice([0.55, 0.7, 1.35])
    new_bal = round(old_bal * factor, 2) if old_bal > 0 else round(random.uniform(20000, 90000), 2)
    old = float(row["churn_risk_score"])
    with session_scope() as session:
        sig = session.get(CustomerSignal, cid) or CustomerSignal(customer_id=cid)
        sig.balance = new_bal
        sig.source = "simulator"
        sig.note = "Large outbound transfer" if factor < 1 else "Salary credit"
        sig.updated_at = datetime.utcnow()
        session.add(sig)
        session.commit()
    new = float(score_all_customers().set_index("CustomerId").loc[cid, "churn_risk_score"])
    direction = "outflow" if factor < 1 else "inflow"
    publish(
        "balance_moved",
        f"{row['Surname']}: large {direction} - balance {old_bal:,.0f} -> {new_bal:,.0f}, risk {old:.0f}% -> {new:.0f}%",
        severity="high" if factor < 1 else None,
        ref={"customerId": cid, "branch": row["branch"]},
        data={"oldBalance": old_bal, "newBalance": new_bal, "old": old, "new": new},
    )


def _tick_outreach_outcome():
    with session_scope() as session:
        done = {o.action_id for o in session.exec(select(OutreachOutcome)).all()}
        pending = [a for a in session.exec(select(OutreachAction)).all() if a.id not in done]
        if not pending:
            return
        a = random.choice(pending)
        a_id, a_channel, a_cid = a.id, a.channel, a.customer_id
        p_retain = 0.75 if a_channel in ("rm_visit", "call") else 0.55
        r = random.random()
        outcome = "retained" if r < p_retain else ("no_response" if r < p_retain + 0.15 else "churned")
        record_outcome(session, a_id, outcome, "Reported by channel (simulated)")
    publish(
        "outreach_outcome",
        f"Outreach #{a_id} via {a_channel.replace('_', ' ')}: customer {outcome.replace('_', ' ')}",
        severity="low" if outcome == "retained" else ("critical" if outcome == "churned" else None),
        ref={"actionId": a_id, "customerId": a_cid},
        data={"outcome": outcome, "channel": a_channel},
    )


def _tick_customer_follow_up():
    with session_scope() as session:
        open_ones = session.exec(select(Complaint).where(Complaint.status != "resolved")).all()
        if not open_ones:
            return
        c = random.choice(open_ones)
        text = random.choice(FOLLOW_UPS)
        session.add(ComplaintMessage(complaint_id=c.id, author="customer", body=text))
        session.commit()
        cid, cname, sev = c.id, c.customer_name, c.severity
    publish(
        "complaint_message",
        f"{cname} followed up on {cid}: \"{text}\"",
        severity="high" if "ombudsman" in text else None,
        ref={"complaintId": cid},
        data={"author": "customer", "body": text},
    )


def _tick_sla_watch():
    now = datetime.utcnow()
    with session_scope() as session:
        open_ones = session.exec(select(Complaint).where(Complaint.status != "resolved")).all()
        for c in open_ones:
            deadline = c.created_at + timedelta(hours=c.sla_hours)
            remaining = (deadline - now).total_seconds() / 60
            key_soon, key_breach = f"{c.id}:soon", f"{c.id}:breach"
            if remaining < 0 and key_breach not in _warned_sla:
                _warned_sla.add(key_breach)
                publish("sla_breached", f"SLA BREACHED: {c.id} ({c.customer_name}, {c.severity})", severity="critical",
                        ref={"complaintId": c.id, "customerId": c.customer_id})
            elif 0 < remaining <= 45 and key_soon not in _warned_sla:
                _warned_sla.add(key_soon)
                publish("sla_warning", f"SLA in {int(remaining)} min: {c.id} ({c.customer_name})", severity="high",
                        ref={"complaintId": c.id, "customerId": c.customer_id})


SCENARIOS = [
    (_tick_new_complaint, 3),
    (_tick_activity_drop, 3),
    (_tick_balance_move, 2),
    (_tick_outreach_outcome, 2),
    (_tick_customer_follow_up, 2),
]


async def _run():
    _state.update(running=True, started_at=datetime.utcnow().isoformat() + "Z", ticks=0)
    publish("simulation", "Live demo mode started", data={"running": True})
    try:
        while True:
            fn = random.choices([s[0] for s in SCENARIOS], weights=[s[1] for s in SCENARIOS])[0]
            try:
                await asyncio.to_thread(fn)
                await asyncio.to_thread(_tick_sla_watch)
                _state["ticks"] += 1
                _state["last_event"] = fn.__name__
            except Exception as exc:  # keep the loop alive; surface the error to the UI
                publish("simulation_error", f"Simulator step failed: {exc}", severity="medium")
            await asyncio.sleep(random.uniform(4, 9) / _state["speed"])
    except asyncio.CancelledError:
        pass
    finally:
        _state["running"] = False
        publish("simulation", "Live demo mode stopped", data={"running": False})


def start(speed: float = 1.0) -> dict:
    global _task
    if _task and not _task.done():
        return status()
    _state["speed"] = max(0.25, min(speed, 5.0))
    _task = asyncio.get_running_loop().create_task(_run())
    return status()


def stop() -> dict:
    global _task
    if _task and not _task.done():
        _task.cancel()
    _task = None
    return status()


def status() -> dict:
    return {**_state, "running": bool(_task and not _task.done())}
