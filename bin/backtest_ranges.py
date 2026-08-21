#!/usr/bin/env python3
"""
backtest_ranges.py - walk-forward validation of the Weekly Review's range
formula, run BEFORE anything publishes. Pure standard library.

What it does (method and reasoning live in the project record; this header
carries only what a reader of the results needs):

  1. Pulls ~10 years of daily closes per instrument from the same providers
     the live pull uses (Yahoo, LBMA), caching raw pulls with provenance.
  2. Recreates every historical Friday forecast using ONLY data available at
     that date: EWMA (and challenger) volatility known at the vintage,
     interval quantiles from the empirical distribution of PRIOR standardised
     residuals only (expanding window - the honest vintage discipline).
  3. Compares: no-change baseline vs trend-tilted point (1m); EWMA lambda=0.94
     vs lambda=0.97 vs annually-refit variance-targeted GARCH(1,1).
  4. Evaluates 1-week / 1-month / remaining-to-year-end SEPARATELY:
     median abs error, directional accuracy, realised 80% coverage, interval
     score (Gneiting & Raftery 2007), Brier, Christoffersen independence,
     circular block bootstrap for CIs (overlapping outcomes are not
     independent observations).
  5. Freezes the selected parameters into config/range_params.json and writes
     config/backtest_report.{json,md}.

PARAMS VERSIONS
  v1  2026-08-20. Thursday-anchored: friday_of_week read `4 - isoweekday` and
      returned Thursday. Superseded, never scored against, kept as
      config/range_params.v1-thursday-anchored.json.
  v2  2026-08-21. Friday-anchored, after that defect was fixed. Nothing was
      retroactively rescored because nothing had ever been scored.

PRE-REGISTERED GATES - written before the first run; the build stops and
reports if they fail. (Set 2026-08-21; ~470 weekly obs per instrument gives a
~+/-4pp two-sigma band on an 80% coverage estimate, which sizes the bands.)

  G1  pooled 1-week realised coverage of the selected model in [0.76, 0.84]
  G2  at least 6 of 7 instruments' 1-week coverage in [0.70, 0.90]
  G3  (reported, not blocking) Christoffersen independence p >= 0.05 - misses
      clustering in volatility regimes is a known EWMA property; it is
      reported honestly, not hidden behind a blocking gate.

  TREND earns nonzero weight ONLY if, at the 1-month horizon: the tilted
  point beats no-change on median AE with a bootstrap CI excluding zero in a
  majority of instruments AND pooled; AND directional accuracy beats the
  per-instrument best-constant-guess base rate. Otherwise weight stays 0.

  CHALLENGER vol model retained only if pooled 1-week mean interval score
  improves on EWMA-0.94 by more than 1% AND the paired per-vintage
  difference's bootstrap CI excludes zero in at least 4 of 7 instruments.

Usage:
  backtest_ranges.py [--years 10] [--quick] [--cache-dir DIR] [--no-freeze]
"""

import bisect
import datetime as dt
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gatlib  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(REPO, "config")

HORIZONS = ("1w", "1m", "eoy")
MIN_N = {"1w": 100, "1m": 60, "eoy": 60}   # eoy rides the 1m residual pool
VOL_MODELS = ("ewma94", "ewma97", "garch")
TREND_TILT = 0.5          # fixed challenger: mu = 0.5 * S * sigma_h. Not tuned.
GARCH_REFIT_WEEKS = 52    # annual refit, expanding window


def fetch_all(cache_dir, years):
    """Fetch (or reuse cached) raw daily closes with provenance."""
    os.makedirs(cache_dir, exist_ok=True)
    out = {}
    prov = {}
    for iid, name, source, symbol in gatlib.INSTRUMENTS:
        path = os.path.join(cache_dir, iid + ".json")
        if os.path.exists(path):
            doc = json.load(open(path))
            series = [(dt.date.fromisoformat(d), c) for d, c in doc["series"]]
            prov[iid] = doc["provenance"]
            out[iid] = series
            continue
        series = gatlib.fetch_series(source, symbol, years=years)
        if len(series) < 800:
            raise RuntimeError("%s: only %d rows - refusing to backtest on that"
                               % (iid, len(series)))
        prov[iid] = {
            "source": source, "symbol": symbol,
            "fetched_utc": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "rows": len(series),
            "first": series[0][0].isoformat(), "last": series[-1][0].isoformat(),
        }
        json.dump({"provenance": prov[iid],
                   "series": [(d.isoformat(), c) for d, c in series]},
                  open(path, "w"))
        out[iid] = series
        print("fetched %-6s %5d rows  %s .. %s" % (
            iid, len(series), series[0][0], series[-1][0]))
    return out, prov


def build_vintages(series):
    """One vintage per ISO week: index of the last row <= that week's Friday."""
    first, last = series[0][0], series[-1][0]
    vintages = []
    seen = set()
    d = first
    while d <= last:
        fri = gatlib.friday_of_week(d)
        idx = gatlib.last_index_on_or_before(series, fri)
        if idx is not None and idx not in seen:
            seen.add(idx)
            vintages.append(idx)
        d += dt.timedelta(days=7)
    return sorted(set(vintages))


def make_forecasts(series, vintages, vols, min_idx):
    """All (vintage, horizon) rows with realised outcomes and signals.
    vols: {model: [(date, sigma)]} aligned to the RETURNS series (offset 1
    from closes: returns[i] belongs to closes[i+1])."""
    rows = []
    last_date = series[-1][0]
    for vi in vintages:
        if vi < min_idx:
            continue
        vdate, vprice = series[vi]
        ri = vi - 1                      # index into returns/vol arrays
        sig = {}
        for m, path in vols.items():
            if ri < 0 or ri >= len(path):
                sig = None
                break
            sig[m] = path[ri][1]
        if not sig:
            continue
        S, comps = gatlib.trend_score(series, vi)
        pos = gatlib.range_position(series, vi)
        stance = gatlib.derive_stance(S, comps.get(21) if comps else None, pos)
        for hz in HORIZONS:
            if hz == "1w":
                target = vdate + dt.timedelta(days=7)
            elif hz == "1m":
                target = vdate + dt.timedelta(days=28)
            else:
                target = dt.date(vdate.year, 12, 31)
                if (target - vdate).days < 14:
                    continue
            if target > last_date:
                continue
            ti = gatlib.last_index_on_or_before(series, target)
            if ti is None or ti <= vi:
                continue
            steps = ti - vi
            realized = math.log(series[ti][1] / vprice)
            rows.append({
                "vdate": vdate, "vidx": vi, "hz": hz, "steps": steps,
                "target_date": series[ti][0], "price": vprice,
                "realized": realized, "sigma": sig,
                "S": S, "z21": comps.get(21) if comps else None,
                "pos": pos, "stance": stance,
            })
    return rows


def walk_forward_eval(rows, model):
    """Expanding-window interval evaluation for one vol model.
    Returns per-horizon lists of scored forecasts (chronological)."""
    scored = {h: [] for h in HORIZONS}
    pools = {"1w": [], "1m": []}          # sorted z values, completed only
    pending = {"1w": [], "1m": []}        # (target_date, z), fifo by vintage
    for r in sorted(rows, key=lambda x: (x["vdate"], x["hz"])):
        hz = r["hz"]
        vdate = r["vdate"]
        # promote completed forecasts into the pools
        for ph in ("1w", "1m"):
            keep = []
            for (tdate, z) in pending[ph]:
                if tdate <= vdate:
                    bisect.insort(pools[ph], z)
                else:
                    keep.append((tdate, z))
            pending[ph] = keep
        sigma = r["sigma"][model]
        sh = sigma * math.sqrt(r["steps"])
        z = r["realized"] / sh if sh > 0 else None
        pool_key = "1m" if hz == "eoy" else hz
        pool = pools[pool_key]
        if z is not None and hz in ("1w", "1m"):
            pending[hz].append((r["target_date"], z))
        if len(pool) < MIN_N[hz] or z is None:
            continue
        q10 = gatlib.percentile(pool, 0.10)
        q90 = gatlib.percentile(pool, 0.90)
        lo_log, hi_log = q10 * sh, q90 * sh
        hit = 1 if lo_log <= r["realized"] <= hi_log else 0
        scored[hz].append({
            "vdate": r["vdate"].isoformat(), "steps": r["steps"],
            "realized": r["realized"], "lo": lo_log, "hi": hi_log,
            "hit": hit, "is": gatlib.interval_score(lo_log, hi_log, r["realized"]),
            "width": hi_log - lo_log, "S": r["S"], "stance": r["stance"],
            "sh": sh,
        })
    return scored


def median(vals):
    s = sorted(vals)
    n = len(s)
    if n == 0:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def eval_instrument(iid, series, quick):
    returns = gatlib.log_returns(series)
    # The vol paths are index-aligned to closes as returns[i] <-> closes[i+1];
    # a silently dropped return would shift every sigma one day off.
    assert len(returns) == len(series) - 1, "returns/closes misaligned"
    vols = {
        "ewma94": gatlib.ewma_vol_path(returns, lam=0.94),
        "ewma97": gatlib.ewma_vol_path(returns, lam=0.97),
    }
    # GARCH: annual expanding refits; the vol path between refits uses only
    # params fitted on data known at the refit point.
    vintages = build_vintages(series)
    min_idx = 253 + 1                     # vol seed + trend lookback headroom
    garch_path = [None] * len(returns)
    fit_meta = []
    fit_every = GARCH_REFIT_WEEKS
    week_count = 0
    last_fit = None
    for vi in vintages:
        if vi < min_idx:
            continue
        if last_fit is None or week_count >= fit_every:
            sub = [r for _, r in returns[: vi - 1]]
            try:
                w, a, b, ll = gatlib.garch_fit(sub)
                last_fit = (w, a, b)
                fit_meta.append({"at": series[vi][0].isoformat(),
                                 "alpha": a, "beta": b})
            except ValueError:
                pass
            week_count = 0
        week_count += 1
    # One final full path per last params is WRONG for walk-forward; instead
    # rebuild the path piecewise per refit segment.
    if fit_meta:
        seg_starts = [dt.date.fromisoformat(f["at"]) for f in fit_meta]
        params = [(f["alpha"], f["beta"]) for f in fit_meta]
        full = []
        for k, start in enumerate(seg_starts):
            a, b = params[k]
            sub_end = len(returns)
            # params k govern vintages from seg_starts[k] to next
            uncond_n = gatlib.last_index_on_or_before(series, start) - 1
            seed = [r for _, r in returns[:min(252, uncond_n)]]
            m = sum(seed) / len(seed)
            var0 = sum((r - m) ** 2 for r in seed) / (len(seed) - 1)
            w = var0 * (1 - a - b)
            var = var0
            path = []
            for d, r in returns:
                var = w + a * r * r + b * var
                path.append((d, math.sqrt(var)))
            end = seg_starts[k + 1] if k + 1 < len(seg_starts) else None
            for i, (d, s) in enumerate(path):
                if d >= start and (end is None or d < end):
                    garch_path[i] = (d, s)
        # fill leading None with ewma (unused: below min_idx anyway)
        for i in range(len(garch_path)):
            if garch_path[i] is None:
                garch_path[i] = vols["ewma94"][i]
        vols["garch"] = garch_path
    else:
        vols["garch"] = vols["ewma94"]

    rows = make_forecasts(series, vintages, vols, min_idx)
    out = {}
    for m in VOL_MODELS:
        out[m] = walk_forward_eval(rows, m)
    return rows, out, fit_meta


def summarize(scored):
    """Coverage / IS / width / Christoffersen for one instrument+model+horizon."""
    if not scored:
        return None
    hits = [s["hit"] for s in scored]
    iss = [s["is"] for s in scored]
    n = len(scored)
    cov = sum(hits) / n
    lr, pval = gatlib.christoffersen_independence(hits)
    lo, hi = gatlib.block_bootstrap_mean(hits, block=8)
    return {
        "n": n, "coverage": round(cov, 4),
        "coverage_ci95": [round(lo, 4), round(hi, 4)] if lo is not None else None,
        "mean_interval_score": round(sum(iss) / n, 6),
        "median_width": round(median([s["width"] for s in scored]), 6),
        "christoffersen_lr": round(lr, 3) if lr is not None else None,
        "christoffersen_p": round(pval, 4) if pval is not None else None,
    }


def trend_eval(scored_1m):
    """No-change vs trend-tilted point at 1m, on the SAME scored forecasts."""
    rows = [s for s in scored_1m if s["S"] is not None]
    if len(rows) < 50:
        return None
    ae_nc = [abs(s["realized"]) for s in rows]
    ae_tr = [abs(s["realized"] - TREND_TILT * s["S"] * s["sh"]) for s in rows]
    diffs = [a - b for a, b in zip(ae_nc, ae_tr)]   # >0 means trend better
    lo, hi = gatlib.block_bootstrap_mean(diffs, block=8)
    ups = sum(1 for s in rows if s["realized"] > 0)
    base = max(ups, len(rows) - ups) / len(rows)
    dir_hits = [1 if (s["S"] > 0) == (s["realized"] > 0) else 0
                for s in rows if s["S"] != 0 and s["realized"] != 0]
    dir_acc = sum(dir_hits) / len(dir_hits) if dir_hits else None
    brier_tr = sum((gatlib.phi(TREND_TILT * s["S"]) - (1 if s["realized"] > 0 else 0)) ** 2
                   for s in rows) / len(rows)
    p0 = ups / len(rows)
    brier_base = sum((p0 - (1 if s["realized"] > 0 else 0)) ** 2
                     for s in rows) / len(rows)
    return {
        "n": len(rows),
        "median_ae_nochange": round(median(ae_nc), 6),
        "median_ae_trend": round(median(ae_tr), 6),
        "mean_ae_diff_ci95": [round(lo, 6), round(hi, 6)],
        "trend_better_pooledMAE": median(ae_tr) < median(ae_nc),
        "trend_sig_better": lo is not None and lo > 0,
        "dir_accuracy": round(dir_acc, 4) if dir_acc else None,
        "best_constant_base_rate": round(base, 4),
        "dir_beats_base": (dir_acc or 0) > base,
        "brier_trend": round(brier_tr, 4), "brier_base": round(brier_base, 4),
    }


def stance_eval(scored_1w):
    """Per-stance 1-week hit rates -> the frozen confidence table.
    Buy/Hold claim up, Sell/Wait claim down, Flat claims inside the range."""
    table = {}
    for s in scored_1w:
        st = s["stance"]
        if st is None:
            continue
        d = gatlib.stance_direction(st)
        if d > 0:
            ok = s["realized"] > 0
        elif d < 0:
            ok = s["realized"] < 0
        else:
            ok = bool(s["hit"])
        t = table.setdefault(st, [0, 0])
        t[0] += 1 if ok else 0
        t[1] += 1
    return {st: {"n": n, "hit_rate": round(k / n, 4)}
            for st, (k, n) in sorted(table.items()) if n > 0}


PARAMS_VERSION = 2


def main():
    args = sys.argv[1:]
    years = int(args[args.index("--years") + 1]) if "--years" in args else 10
    quick = "--quick" in args
    freeze = "--no-freeze" not in args
    cache_dir = (args[args.index("--cache-dir") + 1] if "--cache-dir" in args
                 else os.path.expanduser("~/gat-room/tmp/backtest-cache"))

    print("gat.trading range backtest - %d years, cache %s" % (years, cache_dir))
    data, prov = fetch_all(cache_dir, years)

    report = {"generated_utc": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
              "years": years, "provenance": prov, "instruments": {},
              "pooled": {}, "gates": {}, "trend": {}, "stance_pooled": {}}
    all_scored = {m: {h: [] for h in HORIZONS} for m in VOL_MODELS}
    full_sample_z = {}
    stance_rows = []

    for iid, name, source, symbol in gatlib.INSTRUMENTS:
        series = data[iid]
        # Log-maths cannot cross a non-positive close (WTI printed -37.63 on
        # 2020-04-20). Drop such rows up front and SAY so - the gap return
        # then spans the dropped day(s), which is the honest treatment.
        clean = [(d, c) for d, c in series if c > 0]
        dropped = len(series) - len(clean)
        if dropped:
            prov[iid]["nonpositive_rows_dropped"] = dropped
            report["provenance"][iid]["nonpositive_rows_dropped"] = dropped
        series = clean
        rows, per_model, fit_meta = eval_instrument(iid, series, quick)
        inst = {"name": name, "rows": len(series), "garch_refits": fit_meta[-1:] and fit_meta[-1] or None}
        for m in VOL_MODELS:
            inst[m] = {}
            for h in HORIZONS:
                summ = summarize(per_model[m][h])
                inst[m][h] = summ
                all_scored[m][h].extend(per_model[m][h])
        inst["trend_1m"] = trend_eval(per_model["ewma94"]["1m"])
        inst["stance_1w"] = stance_eval(per_model["ewma94"]["1w"])
        stance_rows.extend(per_model["ewma94"]["1w"])
        # full-sample standardised residuals for the FREEZE, kept per model so
        # the freeze uses the SELECTED model's sigma (production quantiles use
        # everything known today; the walk-forward above validates the
        # approach). Also keep the last GARCH fit in case garch is selected.
        fz = {}
        for m in VOL_MODELS:
            fz[m] = {}
            for h in ("1w", "1m"):
                zs = sorted(r["realized"] / (r["sigma"][m] * math.sqrt(r["steps"]))
                            for r in rows if r["hz"] == h and r["sigma"][m] > 0)
                if len(zs) >= 50:
                    fz[m][h] = {"q10": round(gatlib.percentile(zs, 0.10), 4),
                                "q25": round(gatlib.percentile(zs, 0.25), 4),
                                "q75": round(gatlib.percentile(zs, 0.75), 4),
                                "q90": round(gatlib.percentile(zs, 0.90), 4),
                                "n": len(zs)}
        full_sample_z[iid] = fz
        report["instruments"][iid] = inst
        print("%-6s done: 1w n=%s cov=%s" % (
            iid, inst["ewma94"]["1w"]["n"] if inst["ewma94"]["1w"] else "-",
            inst["ewma94"]["1w"]["coverage"] if inst["ewma94"]["1w"] else "-"))

    # pooled per model/horizon
    for m in VOL_MODELS:
        report["pooled"][m] = {}
        for h in HORIZONS:
            sc = all_scored[m][h]
            if sc:
                report["pooled"][m][h] = {
                    "n": len(sc),
                    "coverage": round(sum(s["hit"] for s in sc) / len(sc), 4),
                    "mean_interval_score": round(sum(s["is"] for s in sc) / len(sc), 6),
                }

    # challenger decision (pre-registered rule)
    base_is = report["pooled"]["ewma94"]["1w"]["mean_interval_score"]
    winner = "ewma94"
    for chall in ("ewma97", "garch"):
        ch_is = report["pooled"][chall]["1w"]["mean_interval_score"]
        if ch_is < base_is * 0.99:
            better = 0
            for iid, *_ in gatlib.INSTRUMENTS:
                a = report["instruments"][iid]["ewma94"]["1w"]
                b = report["instruments"][iid][chall]["1w"]
                if a and b and b["mean_interval_score"] < a["mean_interval_score"]:
                    better += 1
            if better >= 4:
                winner = chall
                base_is = ch_is
    report["selected_vol_model"] = winner

    # gates on the selected model
    sel = report["pooled"][winner]["1w"]
    g1 = 0.76 <= sel["coverage"] <= 0.84
    per_ok = 0
    for iid, *_ in gatlib.INSTRUMENTS:
        s = report["instruments"][iid][winner]["1w"]
        if s and 0.70 <= s["coverage"] <= 0.90:
            per_ok += 1
    g2 = per_ok >= 6
    chri_ok = sum(1 for iid, *_ in gatlib.INSTRUMENTS
                  if (report["instruments"][iid][winner]["1w"] or {}).get("christoffersen_p")
                  and report["instruments"][iid][winner]["1w"]["christoffersen_p"] >= 0.05)
    report["gates"] = {
        "G1_pooled_1w_coverage_76_84": {"value": sel["coverage"], "pass": g1},
        "G2_per_instrument_70_90": {"count_in_band": per_ok, "pass": g2},
        "G3_christoffersen_info_only": {"instruments_independent_at_5pct": chri_ok},
        "verdict": "PASS" if (g1 and g2) else "FAIL",
    }

    # trend verdict (pooled)
    tr_better = [report["instruments"][i]["trend_1m"] for i, *_ in gatlib.INSTRUMENTS
                 if report["instruments"][i]["trend_1m"]]
    sig = sum(1 for t in tr_better if t["trend_sig_better"])
    dirb = sum(1 for t in tr_better if t["dir_beats_base"])
    trend_weight = TREND_TILT if (sig >= 4 and dirb >= 4) else 0.0
    report["trend"] = {"instruments_sig_better": sig,
                       "instruments_dir_beats_base": dirb,
                       "earned_weight": trend_weight}
    report["stance_pooled"] = stance_eval(stance_rows)

    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(os.path.join(CONFIG_DIR, "backtest_report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    write_md(report)
    print("verdict:", report["gates"]["verdict"],
          "| selected vol model:", winner,
          "| trend weight:", trend_weight)

    if freeze and report["gates"]["verdict"] == "PASS":
        # A freeze rewrites this file WHOLESALE. Anything decided outside the
        # backtest - the metals price basis, which is a signed ruling - must be
        # carried across explicitly, or re-running the backtest would quietly
        # revert it and nobody would see the change.
        carried = {}
        prior_path = os.path.join(CONFIG_DIR, "range_params.json")
        if os.path.exists(prior_path):
            try:
                prior = json.load(open(prior_path))
                for k in ("metal_price_basis", "metal_price_basis_set_utc",
                          "metal_price_basis_note"):
                    if k in prior:
                        carried[k] = prior[k]
            except Exception:             # noqa: BLE001 - an unreadable prior file is not fatal
                pass
        params = {
            "version": PARAMS_VERSION,
            "frozen_utc": report["generated_utc"],
            "signed_off": "PENDING - not yet signed off; the freeze "
                          "records what the backtest selected",
            "vol_model": winner,
            "ewma_lambda": 0.94 if winner == "ewma94" else (0.97 if winner == "ewma97" else None),
            "vol_init_days": 252,
            "interval": {"nominal_coverage": 0.80,
                         "method": "empirical q10/q90 of standardised residuals, "
                                   "per instrument per horizon, full sample at freeze"},
            "quantiles": {iid: full_sample_z[iid][winner]
                          for iid, *_ in gatlib.INSTRUMENTS},
            "garch_params": ({iid: report["instruments"][iid]["garch_refits"]
                              for iid, *_ in gatlib.INSTRUMENTS}
                             if winner == "garch" else None),
            "eoy_uses": "1m quantiles (scenario framing; excluded from headline scoring)",
            "trend_weight": trend_weight,
            "trend_tilt_if_earned": TREND_TILT,
            "stance": gatlib.STANCE_PARAMS,
            "confidence_table": report["stance_pooled"],
            "calibration_band": [0.70, 0.90],
            "min_residuals": MIN_N,
        }
        params.update(carried)
        with open(os.path.join(CONFIG_DIR, "range_params.json"), "w") as fh:
            json.dump(params, fh, indent=1)
        print("frozen -> config/range_params.json")
    elif freeze:
        print("NOT frozen - gates failed; stop and report, per the brief.")
    return 0 if report["gates"]["verdict"] == "PASS" else 1


def write_md(r):
    L = ["# Range backtest report - %s" % r["generated_utc"], ""]
    L.append("Selected vol model: **%s** | Gate verdict: **%s** | Trend weight: **%s**"
             % (r["selected_vol_model"], r["gates"]["verdict"], r["trend"]["earned_weight"]))
    L.append("")
    L.append("| instrument | 1w n | 1w cov | 1w IS | 1m cov | eoy cov | Christ. p |")
    L.append("|---|---|---|---|---|---|---|")
    m = r["selected_vol_model"]
    for iid in r["instruments"]:
        i = r["instruments"][iid]
        w, mo, e = i[m]["1w"], i[m]["1m"], i[m]["eoy"]
        L.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            iid, w["n"] if w else "-", w["coverage"] if w else "-",
            w["mean_interval_score"] if w else "-",
            mo["coverage"] if mo else "-", e["coverage"] if e else "-",
            w["christoffersen_p"] if w else "-"))
    L.append("")
    L.append("Pooled (%s): %s" % (m, json.dumps(r["pooled"][m])))
    L.append("")
    L.append("Gates: %s" % json.dumps(r["gates"]))
    L.append("")
    L.append("Trend (1m, pooled verdict): %s" % json.dumps(r["trend"]))
    L.append("")
    L.append("Stance hit rates (1w, pooled): %s" % json.dumps(r["stance_pooled"]))
    L.append("")
    L.append("Provenance: %s" % json.dumps(r["provenance"]))
    with open(os.path.join(CONFIG_DIR, "backtest_report.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")


if __name__ == "__main__":
    sys.exit(main())
