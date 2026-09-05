#!/usr/bin/env python3
"""
weekly_forecast.py - stages 0-2 of the Weekly Review pipeline. Deterministic.

  stage 0  score every stored forecast that has matured; write
           data/weekly/scorecard.json and data/calibration.json.
           The calibration step MEASURES the frozen formula's trailing
           coverage - it never re-fits anything.
  stage 1  build one frozen input object per instrument: closes, trend
           scores, EWMA volatility, no-change base case, 80% bounds,
           dated macro events in the forecast window.
  stage 2  produce ALL published numbers - prices, ranges, stances, flip
           levels, confidence - BEFORE any language model sees any news.

Outputs (server-side, never published directly):
  ~/gat-room/tmp/weekly/skeleton-<WEEK>.json     full numbers + series tails
  ~/gat-room/tmp/weekly/model-input-<WEEK>.json  the model's copy - carries
      aggregate calibration ONLY; each asset's own prior calls are withheld
      (shown its previous call, a model defends it or over-corrects - both
      are anchoring, both corrupt the record)

The language model writes words around these numbers and may never alter
one; the publisher re-derives and refuses mismatches.

Exit codes: 0 ok, 1 error, 3 the week's review is already published
(the scheduled run treats 3 as "verify-only").
"""

import datetime as dt
import hashlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gatlib  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")
WEEKLY = os.path.join(DATA, "weekly")
CONFIG = os.path.join(REPO, "config")
TMP = os.path.expanduser("~/gat-room/tmp/weekly")

COHERENCE_PAIRS = [("dxy", "gold", -1), ("dxy", "wti", -1), ("btc", "ndx", 1)]
STALE_DAYS = 7          # a feed older than this is No data, not an opinion
CACHE_MAX_AGE_H = 6     # re-fetch a history series older than this; see fetch_all


def load_params():
    p = json.load(open(os.path.join(CONFIG, "range_params.json")))
    if p.get("vol_model") != "ewma94":
        raise SystemExit("range_params vol_model %r not supported by this build"
                         % p.get("vol_model"))
    basis = p.get("metal_price_basis", "lbma_fix")
    if basis not in ("lbma_fix", "spot_anchored"):
        raise SystemExit("range_params metal_price_basis %r not supported by "
                         "this build" % basis)
    p["metal_price_basis"] = basis
    return p


def review_friday_for(asof):
    f = gatlib.friday_of_week(asof)
    return f if f <= asof else f - dt.timedelta(days=7)


def fetch_all(asof, params=None):
    cache = os.path.join(TMP, "cache-%s" % asof.isoformat())
    os.makedirs(cache, exist_ok=True)
    series, failures = {}, {}
    for iid, name, source, symbol in gatlib.INSTRUMENTS:
        path = os.path.join(cache, iid + ".json")
        try:
            # The cache is keyed on asof, but a date is not a freshness test.
            # The LBMA feed picks up a day's fix late in the UTC evening, so a
            # cache written before that carries yesterday's fix for the whole
            # of the following day - which is exactly why the inaugural review
            # went out carrying the 19 Aug fix when the 20 Aug fix existed.
            # An age check costs one extra download and removes the whole class
            # of problem. CACHE_MAX_AGE_H is deliberately longer than a run:
            # the skeleton must not move underneath the words being written for
            # it, and the publisher refuses a stale skeleton anyway.
            fresh = False
            if os.path.exists(path):
                doc = json.load(open(path))
                try:
                    age = (dt.datetime.utcnow() - dt.datetime.fromisoformat(
                        doc["fetched_utc"].rstrip("Z")))
                    fresh = dt.timedelta(0) <= age < dt.timedelta(hours=CACHE_MAX_AGE_H)
                except Exception:         # noqa: BLE001 - an unreadable stamp is not fresh
                    fresh = False
            if fresh:
                s = [(dt.date.fromisoformat(d), c) for d, c in doc["series"]]
            else:
                s = gatlib.fetch_series(source, symbol, years=10)
                json.dump({"fetched_utc": dt.datetime.utcnow().isoformat() + "Z",
                           "series": [(d.isoformat(), c) for d, c in s]},
                          open(path, "w"))
            s = [(d, c) for d, c in s if c > 0 and d <= asof]
            if len(s) < 800:
                raise RuntimeError("only %d usable rows" % len(s))
            # The anchor is applied AFTER the cache, never inside it: the spot
            # quote must be live on every run, while the ten-year history is
            # fetched once a day. See gatlib.anchor_on_spot for the whole
            # argument, including what this basis costs.
            if (params or {}).get("metal_price_basis") == "spot_anchored":
                s = gatlib.anchor_on_spot(iid, s, asof)
            series[iid] = s
        except Exception as e:            # noqa: BLE001 - a dead feed becomes No data, honestly
            failures[iid] = str(e)
    return series, failures


# ---------------------------------------------------------------- stage 0

def score_matured(series, asof):
    """Score every stored forecast whose target date has passed and is
    covered by data. Never edits the weekly files themselves."""
    sc_path = os.path.join(WEEKLY, "scorecard.json")
    sc = {"weeks": {}}
    if os.path.exists(sc_path):
        try:
            sc = json.load(open(sc_path))
        except Exception:                 # noqa: BLE001 - a corrupt scorecard is rebuilt from the files
            sc = {"weeks": {}}
    sc.setdefault("weeks", {})

    week_files = sorted(f for f in os.listdir(WEEKLY)
                        if f.endswith(".json") and f[:4].isdigit() and "-W" in f) \
        if os.path.isdir(WEEKLY) else []

    for fn in week_files:
        doc = json.load(open(os.path.join(WEEKLY, fn)))
        wk = doc.get("week")
        if not wk:
            continue
        rec = sc["weeks"].setdefault(wk, {"assets": {}})
        for a in doc.get("assets", []):
            iid = a.get("id")
            fc = a.get("forecast")
            if not fc:
                continue
            arec = rec["assets"].setdefault(iid, {})
            s = series.get(iid)
            for hz in ("next_week", "next_month", "eoy"):
                h = fc.get(hz)
                if not h or hz in arec:
                    continue
                tgt = dt.date.fromisoformat(h["target_date"])
                if s is None or s[-1][0] < tgt:
                    continue              # not matured or feed down - later run scores it
                ti = gatlib.last_index_on_or_before(s, tgt)
                close = s[ti][1]
                base = h["base"]
                entry = {
                    "target_date": h["target_date"],
                    "close": round(close, 6),
                    "realized_pct": round((close / base - 1) * 100, 3),
                    "range_hit": bool(h["lo"] <= close <= h["hi"])
                    if h.get("lo") is not None else None,
                    "width_pct": round((h["hi"] - h["lo"]) / base * 100, 2)
                    if h.get("lo") is not None else None,
                    "scored_utc": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                }
                if hz == "eoy":
                    entry["excluded_from_headline"] = True
                if hz == "next_week":
                    st = (a.get("stance") or {}).get("state")
                    entry["stance"] = st
                    d = gatlib.stance_direction(st)
                    if d > 0:
                        entry["stance_hit"] = close > base
                    elif d < 0:
                        entry["stance_hit"] = close < base
                    elif st == "Flat":
                        entry["stance_hit"] = entry["range_hit"]
                arec[hz] = entry

    # aggregate - recomputed in full from the scorecard every run (derived truth)
    agg = {"weekly": _agg(sc, None),
           "rolling_12w": _agg(sc, 12)}
    decl = {"no_read": 0, "no_data": 0}
    for fn in week_files:
        doc = json.load(open(os.path.join(WEEKLY, fn)))
        for a in doc.get("assets", []):
            if a.get("state") == "No read":
                decl["no_read"] += 1
            elif a.get("state") == "No data":
                decl["no_data"] += 1
    agg["declines_all_time"] = decl
    sc["aggregate"] = agg
    sc["updated_utc"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    os.makedirs(WEEKLY, exist_ok=True)
    json.dump(sc, open(sc_path, "w"), indent=1)

    # calibration - trailing 52 reviewed weeks of 1-week range hits
    weeks_sorted = sorted(sc["weeks"])[-52:]
    per_asset, pooled_n, pooled_hit = {}, 0, 0
    for wk in weeks_sorted:
        for iid, arec in sc["weeks"][wk]["assets"].items():
            e = arec.get("next_week")
            if e and e.get("range_hit") is not None:
                pa = per_asset.setdefault(iid, [0, 0])
                pa[0] += 1 if e["range_hit"] else 0
                pa[1] += 1
                pooled_n += 1
                pooled_hit += 1 if e["range_hit"] else 0
    band = [0.70, 0.90]
    pooled_cov = round(pooled_hit / pooled_n, 4) if pooled_n else None
    calib = {
        "updated_utc": sc["updated_utc"],
        "note": "Measures the FROZEN formula's trailing coverage. Never re-fits.",
        "trailing_weeks": len(weeks_sorted),
        "per_asset": {i: {"n": n, "coverage": round(k / n, 4)}
                      for i, (k, n) in sorted(per_asset.items())},
        "pooled": {"n": pooled_n, "coverage": pooled_cov},
        "band": band,
        "flag": ("INSUFFICIENT-HISTORY" if pooled_n < 35 else
                 ("OK" if band[0] <= pooled_cov <= band[1] else "COVERAGE-DRIFT")),
    }
    if calib["flag"] == "COVERAGE-DRIFT":
        calib["action"] = ("Raise for review. The frozen formula's trailing "
                           "coverage left its band; re-fitting is NOT the fix "
                           "and needs his sign-off.")
    json.dump(calib, open(os.path.join(DATA, "calibration.json"), "w"), indent=1)
    return sc, calib


def _agg(sc, last_n):
    weeks = sorted(sc["weeks"])
    if last_n:
        weeks = weeks[-last_n:]
    called = hit = flat_n = flat_hit = rng_n = rng_hit = 0
    widths = []
    best = worst = None
    for wk in weeks:
        for iid, arec in sc["weeks"][wk]["assets"].items():
            e = arec.get("next_week")
            if not e:
                continue
            if e.get("range_hit") is not None:
                rng_n += 1
                rng_hit += 1 if e["range_hit"] else 0
                if e.get("width_pct") is not None:
                    widths.append(e["width_pct"])
            st = e.get("stance")
            d = gatlib.stance_direction(st)
            if d != 0 and e.get("stance_hit") is not None:
                called += 1
                hit += 1 if e["stance_hit"] else 0
                signed = e["realized_pct"] * d
                tag = {"week": wk, "asset": iid, "stance": st,
                       "realized_pct": e["realized_pct"]}
                if best is None or signed > best[0]:
                    best = (signed, tag)
                if worst is None or signed < worst[0]:
                    worst = (signed, tag)
            elif st == "Flat" and e.get("stance_hit") is not None:
                flat_n += 1
                flat_hit += 1 if e["stance_hit"] else 0
    return {
        "weeks": len(weeks),
        "directional": {"n": called, "hit": hit,
                        "rate": round(hit / called, 4) if called else None},
        "flat": {"n": flat_n, "hit": flat_hit,
                 "rate": round(flat_hit / flat_n, 4) if flat_n else None},
        "range_1w": {"n": rng_n, "hit": rng_hit,
                     "coverage": round(rng_hit / rng_n, 4) if rng_n else None},
        "avg_width_pct": round(sum(widths) / len(widths), 2) if widths else None,
        "best_read": best[1] if best else None,
        "worst_read": worst[1] if worst else None,
    }


# ---------------------------------------------------------------- stage 1+2

def _source_label(iid, params):
    """What the level actually came from - which is not always one feed.

    Under the spot-anchored basis the newest observation IS the live spot
    quote while the history behind it is the LBMA fix series, so a bare
    "lbma:gold_pm" would sit on the card directly above a note saying the
    level came from spot. Provenance that contradicts itself is worse than
    provenance that is long."""
    base = dict((i[0], "%s:%s" % (i[2], i[3])) for i in gatlib.INSTRUMENTS)[iid]
    if (iid in gatlib.SPOT_SYMBOL
            and params.get("metal_price_basis") == "spot_anchored"):
        return "gold-api:%s spot + %s history" % (gatlib.SPOT_SYMBOL[iid], base)
    return base


def build_asset(iid, name, s, params, review_friday, calendar_pick, failures):
    asof_note = None
    if iid in failures:
        return {"id": iid, "name": name, "state": "No data",
                "reason": "feed failed: %s" % failures[iid][:160]}
    price_date, price = s[-1][0], s[-1][1]
    if (review_friday - price_date).days > STALE_DAYS:
        return {"id": iid, "name": name, "state": "No data",
                "price": price, "price_date": price_date.isoformat(),
                "reason": "last close is %d days old - feed stale"
                          % (review_friday - price_date).days}

    idx = len(s) - 1
    returns = gatlib.log_returns(s)
    volpath = gatlib.ewma_vol_path(returns, lam=params["ewma_lambda"])
    sigma = volpath[-1][1]
    S, comps = gatlib.trend_score(s, idx)
    pos = gatlib.range_position(s, idx)
    z21 = comps.get(21) if comps else None

    prev_anchor_i = gatlib.last_index_on_or_before(
        s, review_friday - dt.timedelta(days=7))
    week_change = ((price / s[prev_anchor_i][1] - 1) * 100
                   if prev_anchor_i is not None else None)

    base = {
        "id": iid, "name": name,
        "price": round(price, 6), "price_date": price_date.isoformat(),
        "week_change_pct": round(week_change, 3) if week_change is not None else None,
        "signals": {
            "trend_score": round(S, 4) if S is not None else None,
            "trend_components": {str(k): round(v, 4) for k, v in comps.items()},
            "z21": round(z21, 4) if z21 is not None else None,
            "range_pos_252d": round(pos, 4) if pos is not None else None,
            "sigma_daily": round(sigma, 6),
            "trend_weight_in_numbers": params["trend_weight"],
        },
        "source": _source_label(iid, params),
    }
    # One line on the card, for the two instruments whose level and whose
    # volatility history are not the same quote. A reader holding both tabs
    # open must never have to guess why two numbers for one metal differ.
    if iid in gatlib.SPOT_SYMBOL:
        base["price_basis_note"] = (
            "level from live spot; volatility estimated from the LBMA fix series"
            if params.get("metal_price_basis") == "spot_anchored" else
            "level is the LBMA benchmark fix, one official print a day; the "
            "Markets tab quotes live spot, which sits a little either side of it")
    if asof_note:
        base["note"] = asof_note

    if calendar_pick and calendar_pick["asset"] == iid:
        base["state"] = "No read"
        base["no_read"] = {k: calendar_pick[k] for k in
                           ("name", "date", "kind", "source")}
        return base

    q = params["quantiles"][iid]
    fc = {}
    for hz, qkey, delta in (("next_week", "1w", 7), ("next_month", "1m", 28)):
        target = review_friday + dt.timedelta(days=delta)
        steps = gatlib.expected_steps(iid, price_date, target)
        lo, hi = gatlib.interval_from_quantiles(
            price, sigma, steps, q[qkey]["q10"], q[qkey]["q90"])
        fc[hz] = {"target_date": target.isoformat(), "base": round(price, 6),
                  "lo": round(lo, 6), "hi": round(hi, 6), "steps": steps,
                  "coverage": 0.80}
    eoy_target = dt.date(review_friday.year, 12, 31)
    if (eoy_target - review_friday).days >= 14:
        steps = gatlib.expected_steps(iid, price_date, eoy_target)
        sh = sigma * math.sqrt(steps)
        qm = q["1m"]
        fc["eoy"] = {
            "target_date": eoy_target.isoformat(), "base": round(price, 6),
            "steps": steps,
            "central": {"lo": round(price * math.exp(qm["q25"] * sh), 6),
                        "hi": round(price * math.exp(qm["q75"] * sh), 6),
                        "prob": 0.50},
            "upside": {"above": round(price * math.exp(qm["q75"] * sh), 6),
                       "prob": 0.25},
            "downside": {"below": round(price * math.exp(qm["q25"] * sh), 6),
                         "prob": 0.25},
            "envelope_80": {"lo": round(price * math.exp(qm["q10"] * sh), 6),
                            "hi": round(price * math.exp(qm["q90"] * sh), 6)},
            "lo": round(price * math.exp(qm["q10"] * sh), 6),
            "hi": round(price * math.exp(qm["q90"] * sh), 6),
            "note": "scenarios, not a forecast; excluded from the headline record",
        }
    base["forecast"] = fc

    stance = gatlib.derive_stance(S, z21, pos)
    flip, flip_to = gatlib.flip_level(s, idx)
    conf = (params.get("confidence_table", {}).get(stance) or {}).get("hit_rate")
    base["state"] = stance
    base["stance"] = {
        "state": stance,
        "flip_level": round(flip, 6) if flip is not None else None,
        "flip_to": flip_to,
        "confidence": conf,
        "confidence_meaning": "historical probability that this stance's "
                              "one-week claim holds (backtest, pooled)",
    }
    base["_series_tail"] = [(d.isoformat(), c) for d, c in s[-400:]]
    return base


def pick_no_read(assets_order, calendar, review_friday, failures):
    """At most ONE No-read per report; never the same asset twice running."""
    window_lo = review_friday
    window_hi = review_friday + dt.timedelta(days=7)
    prev_no_read = set()
    if os.path.isdir(WEEKLY):
        wf = sorted(f for f in os.listdir(WEEKLY)
                    if f.endswith(".json") and f[:4].isdigit() and "-W" in f)
        if wf:
            prev = json.load(open(os.path.join(WEEKLY, wf[-1])))
            prev_no_read = {a["id"] for a in prev.get("assets", [])
                            if a.get("state") == "No read"}
    cands = []
    for ev in calendar.get("events", []):
        d = dt.date.fromisoformat(ev["date"])
        # schema 2 renamed the gated instrument; schema 1 files still read.
        primary = ev.get("primary", ev.get("asset"))
        # A date the issuer's own calendar could not be read from is carried on
        # the record but NEVER gates a forecast. Declining a real forecast on a
        # date nobody could verify would be gating on a guess.
        if ev.get("confirmed", "official") != "official":
            continue
        if window_lo < d <= window_hi and primary in assets_order:
            cands.append({"asset": primary, "name": ev["name"],
                          "date": ev["date"], "kind": ev["kind"],
                          "source": ev["source"],
                          "scope": ev.get("scope"),
                          "instruments": ev.get("instruments")})
    cands.sort(key=lambda c: (c["date"], assets_order.index(c["asset"])))
    for c in cands:
        if c["asset"] in prev_no_read or c["asset"] in failures:
            continue
        return c
    return None


def freeze_calendar(path, calendar, review_friday, horizon_days=28):
    """Copy the calendar AS IT STANDS into this forecast, hash and all.

    Without this the calendar is a live file: an event could be added after a
    market moved and the record would show a forecast correctly declined, with
    nothing to prove the event had not simply been backfilled. Hindsight
    contamination dressed as a record.

    The frozen copy is what the publisher validates a No read against, and
    what a reader can check the review's declines against years later. The
    sha256 is of the WHOLE file, so a change anywhere in it - including to the
    admission rule itself - is detectable from any published review."""
    try:
        with open(path, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
    except OSError as exc:
        raise SystemExit("cannot read the macro calendar to freeze it: %s" % exc)
    lo, hi = review_friday, review_friday + dt.timedelta(days=horizon_days)
    events = [e for e in calendar.get("events", [])
              if lo < dt.date.fromisoformat(e["date"]) <= hi]
    return {
        "source_file": "config/macro_calendar.json",
        "calendar_schema": calendar.get("schema"),
        "calendar_updated": calendar.get("updated"),
        "sha256": digest,
        "frozen_utc": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "gate_window_days": 7,
        "horizon_days": horizon_days,
        "events": events,
        "note": ("The macro calendar as it stood when this review was generated. "
                 "Declines in this review were gated on THIS copy and nothing "
                 "else. An event absent here could not have gated this review, "
                 "whatever the live calendar says now."),
    }


def main():
    args = sys.argv[1:]
    asof = (dt.date.fromisoformat(args[args.index("--asof") + 1])
            if "--asof" in args else dt.date.today())
    params = load_params()
    calendar_path = os.path.join(CONFIG, "macro_calendar.json")
    calendar = json.load(open(calendar_path))

    review_friday = review_friday_for(asof)
    week = gatlib.iso_week(review_friday)
    out_file = os.path.join(WEEKLY, "%s.json" % week)
    if os.path.exists(out_file):
        print("ALREADY-PUBLISHED %s - this week's review exists; never edited."
              % week)
        return 3

    os.makedirs(TMP, exist_ok=True)
    series, failures = fetch_all(asof, params)
    sc, calib = score_matured(series, asof)

    assets_order = [i[0] for i in gatlib.INSTRUMENTS]
    pick = pick_no_read(assets_order, calendar, review_friday, failures)

    assets = []
    prev_wk = gatlib.iso_week(review_friday - dt.timedelta(days=7))
    for iid, name, source, symbol in gatlib.INSTRUMENTS:
        a = build_asset(iid, name, series.get(iid), params,
                        review_friday, pick, failures)
        # The prior scored call rides in the skeleton for the PAGE. It is
        # stripped from the model input - anchoring corrupts the record.
        lw = ((sc.get("weeks", {}).get(prev_wk, {}).get("assets", {})
               .get(iid, {})).get("next_week"))
        a["last_week"] = ({"week": prev_wk, "stance": lw.get("stance"),
                           "stance_hit": lw.get("stance_hit"),
                           "range_hit": lw.get("range_hit"),
                           "realized_pct": lw.get("realized_pct")}
                          if lw else None)
        assets.append(a)

    # coherence pre-check on the mechanical stances
    stances = {a["id"]: (a.get("stance") or {}).get("state") for a in assets}
    violations = []
    for a_id, b_id, expected in COHERENCE_PAIRS:
        da = gatlib.stance_direction(stances.get(a_id))
        db = gatlib.stance_direction(stances.get(b_id))
        if da != 0 and db != 0 and da * db == -expected:
            violations.append({
                "pair": [a_id, b_id],
                "expected": "negative" if expected < 0 else "positive",
                "stances": [stances[a_id], stances[b_id]],
            })

    skeleton = {
        "schema": 1, "week": week,
        "forecast_week": gatlib.iso_week(review_friday + dt.timedelta(days=7)),
        "review_friday": review_friday.isoformat(),
        "generated_utc": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "vintage": {"asof": asof.isoformat(),
                    "note": ("inaugural mid-week run" if asof < review_friday or
                             asof == review_friday else None)},
        "params_version": params["version"],
        "calendar_frozen": freeze_calendar(calendar_path, calendar, review_friday),
        "nominal_coverage": 0.80,
        "assets": assets,
        "coherence": {"violations": violations, "note": None},
        "declines": {
            "no_read": sum(1 for a in assets if a["state"] == "No read"),
            "no_data": sum(1 for a in assets if a["state"] == "No data")},
        "scorecard": sc.get("aggregate"),
        "calibration": {"pooled": calib["pooled"], "flag": calib["flag"]},
    }
    skel_path = os.path.join(TMP, "skeleton-%s.json" % week)
    json.dump(skeleton, open(skel_path, "w"), indent=1)

    model_input = json.loads(json.dumps(skeleton))    # deep copy
    for a in model_input["assets"]:
        a.pop("_series_tail", None)
        a.pop("last_week", None)
    model_input.pop("scorecard", None)
    model_input["aggregate_calibration"] = {
        "range_coverage": calib["pooled"],
        "per_stance_hit_rates": params.get("confidence_table"),
        "note": "Aggregate feedback only. Prior per-asset calls are withheld "
                "from the model by design - anchoring corrupts the record.",
    }
    # From the FROZEN copy, so the model sees exactly the calendar the record
    # was gated on - not a file that could have been edited in between.
    model_input["calendar_events_in_window"] = list(
        skeleton["calendar_frozen"]["events"])
    mi_path = os.path.join(TMP, "model-input-%s.json" % week)
    json.dump(model_input, open(mi_path, "w"), indent=1)

    print("week %s | assets %d | no_read %s | no_data %d | violations %d"
          % (week, len(assets),
             (pick or {}).get("asset", "-"),
             skeleton["declines"]["no_data"], len(violations)))
    print("skeleton   -> %s" % skel_path)
    print("model-input-> %s" % mi_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
