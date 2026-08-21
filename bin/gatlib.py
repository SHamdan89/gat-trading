#!/usr/bin/env python3
"""
gatlib.py - shared engine for the gat.trading Weekly Review.

Every NUMBER the weekly review publishes is produced by the functions in this
file, and the walk-forward backtest (backtest_ranges.py) validates these same
functions. The production job and the backtest must never hold two copies of a
formula - that is the whole reason this module exists.

Pure standard library, Python 3.9. No numpy, no third-party anything - the
build account has no toolchain and adding one was ruled out deliberately.

Method (decided 2026-08-21 from two independent research reviews; the project
project record carries the reasoning - do not re-litigate here):
  - Base case: no change, at every horizon (Welch & Goyal 2008; Goyal, Welch
    & Zafirov 2024 - published return predictors fail out of sample).
  - Ranges: 80% prediction intervals from EWMA conditional volatility times
    EMPIRICAL 10th/90th percentiles of standardised forecast residuals -
    never a Gaussian assumption; weekly returns are fat-tailed everywhere,
    BTC severely.
  - Trend score: computed and displayed, ZERO weight in published numbers
    unless the walk-forward backtest shows it beats no-change (Kim, Tse &
    Wald 2020 - the contested citation wins).
  - Stance: mechanical thresholds on the computed signals; the flip level is
    the nearest future close that moves the signal into a different bucket.
  - Confidence: the estimated probability the directional stance is correct,
    from per-stance historical hit rates. It never touches range width.
"""

import datetime as dt
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) gat.trading/1.0"

# The seven instruments of the Weekly Review, in page order.
# Note: Nasdaq 100 (^NDX), deliberately NOT the Composite (^IXIC) that the
# Markets tab carried first - different indices, and forecasts scored against
# the wrong series would be meaningless.
INSTRUMENTS = [
    ("gold",   "Gold (spot)",        "lbma",  "gold_pm"),
    ("silver", "Silver (spot)",      "lbma",  "silver"),
    ("wti",    "Oil (WTI)",          "yahoo", "CL=F"),
    ("btc",    "Bitcoin",            "yahoo", "BTC-USD"),
    ("spx",    "S&P 500",            "yahoo", "^GSPC"),
    ("ndx",    "Nasdaq 100",         "yahoo", "^NDX"),
    ("dxy",    "US Dollar Index",    "yahoo", "DX-Y.NYB"),
]

TRADING_DAYS = {"1w": 5, "1m": 21}     # nominal, for display; maths uses actual steps

# Markets that trade seven days a week - their horizon step-counts use
# calendar days, everyone else's use weekdays.
SEVEN_DAY = {"btc"}


def expected_steps(iid, start, target):
    """Expected number of return observations between two dates (exclusive
    start, inclusive target). Weekday count for 5-day markets - a market
    holiday inside the window costs ~one step of width, accepted and
    documented; calendar days for 7-day markets."""
    if iid in SEVEN_DAY:
        return max((target - start).days, 1)
    n, d = 0, start
    while d < target:
        d += dt.timedelta(days=1)
        if d.isoweekday() <= 5:
            n += 1
    return max(n, 1)


# ---------------------------------------------------------------- fetch

def _get(url, tries=3, timeout=45):
    last = None
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:            # noqa: BLE001 - retry everything transient
            last = e
            time.sleep(2.0 * (n + 1))
    raise RuntimeError("GET failed after %d tries: %s (%s)" % (tries, url, last))


def yahoo_daily(symbol, rng="10y"):
    """[(date, close), ...] oldest first, None closes dropped."""
    enc = urllib.parse.quote(symbol, safe="")
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           "%s?range=%s&interval=1d" % (enc, rng))
    doc = json.loads(_get(url))
    res = doc.get("chart", {}).get("result")
    if not res:
        err = doc.get("chart", {}).get("error") or {}
        raise RuntimeError("yahoo %s: %s" % (symbol, err.get("description", "no result")))
    r = res[0]
    stamps = r.get("timestamp") or []
    closes = (r.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
    out = []
    for ts, c in zip(stamps, closes):
        if c is None:
            continue
        out.append((dt.datetime.utcfromtimestamp(ts).date(), float(c)))
    out.sort(key=lambda x: x[0])
    # Yahoo can emit two rows for the live session; keep the last per day.
    dedup = {}
    for d, c in out:
        dedup[d] = c
    return sorted(dedup.items())


def lbma_daily(name, since=None):
    """LBMA benchmark fixes, USD column, oldest first."""
    doc = json.loads(_get("https://prices.lbma.org.uk/json/%s.json"
                          % urllib.parse.quote(name), timeout=60))
    out = []
    for e in doc:
        v = e.get("v") or []
        if not v or v[0] in (None, "", 0):
            continue
        try:
            d = dt.datetime.strptime(e["d"], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        if since and d < since:
            continue
        out.append((d, float(v[0])))
    out.sort(key=lambda x: x[0])
    return out


# Live spot quotes for the two metals. Used ONLY when range_params.json sets
# metal_price_basis to "spot_anchored".
#
# WHY THIS EXISTS. The metals' history is the LBMA benchmark fix - one official
# print a day, free, back to 1968, and the only daily metals history available
# without a paid key. The Markets tab quotes live spot, because that is the
# number a reader sees quoted everywhere else. They are two legitimate quotes
# of the same metal and they sit apart by ordinary noise: measured 2026-08-21,
# gold +0.94% and silver +2.41%, which is 0.6 of a daily standard deviation for
# both. Small, but visible to anyone holding the two tabs side by side.
#
# "spot_anchored" closes that gap by making the newest observation of the
# series the live spot quote instead of the day's fix, so the level, the flip
# level, the week change and the forecast base all sit on the number the
# Markets tab shows. Volatility history stays on the fix series - measured
# effect on EWMA sigma of appending the spot point: gold 0.01365 -> 0.01343,
# silver 0.02509 -> 0.02501. Negligible.
#
# WHAT IT COSTS, so nobody turns it on without knowing. The frozen quantiles
# were fitted on fix-to-fix returns. Under this basis a forecast is made from
# spot and scored against the fix at its target date, which adds roughly a
# quarter of a weekly standard deviation of basis noise to the realised
# outcome and should pull measured coverage slightly below the 0.80 nominal.
# The weekly calibration measurement already watches for exactly that and
# raises COVERAGE-DRIFT. It also changes published calls: on 2026-08-21 silver
# read Flat on the fix basis and Hold on the spot basis.
SPOT_SYMBOL = {"gold": "XAU", "silver": "XAG"}


def spot_quote(symbol):
    """Live spot metal price. Free, no key, current price only - no history."""
    doc = json.loads(_get("https://api.gold-api.com/price/%s"
                          % urllib.parse.quote(symbol), timeout=30))
    if doc.get("price") is None:
        raise RuntimeError("gold-api returned no price for %s" % symbol)
    return float(doc["price"])


def anchor_on_spot(iid, series, asof):
    """Return series with its newest observation replaced by the live spot
    quote, so the published level equals what the Markets tab shows.

    A fix already printed for asof is superseded rather than duplicated - the
    series must stay one observation per date, strictly increasing."""
    if iid not in SPOT_SYMBOL or not series:
        return series
    px = spot_quote(SPOT_SYMBOL[iid])
    last_d = series[-1][0]
    if last_d == asof:
        return series[:-1] + [(asof, px)]
    return series + [(asof, px)]


def fetch_series(source, symbol, years=10):
    since = dt.date.today() - dt.timedelta(days=int(years * 365.25) + 10)
    if source == "yahoo":
        s = yahoo_daily(symbol, rng="%dy" % years)
    elif source == "lbma":
        s = lbma_daily(symbol, since=since)
    else:
        raise ValueError("unknown source %r" % source)
    return [(d, c) for d, c in s if d >= since]


# ---------------------------------------------------------------- maths

def log_returns(series):
    """[(date, r)] for consecutive closes; r = ln(P_t / P_{t-1})."""
    out = []
    for i in range(1, len(series)):
        p0, p1 = series[i - 1][1], series[i][1]
        if p0 > 0 and p1 > 0:
            out.append((series[i][0], math.log(p1 / p0)))
    return out


def ewma_vol_path(returns, lam=0.94, init_n=252):
    """Per-date EWMA daily volatility, initialised from the first init_n
    observations' sample variance. Entry i holds the volatility KNOWN at the
    close of returns[i] (uses r_i and earlier - a forecast made after that
    close may use it without look-ahead)."""
    if len(returns) < init_n + 1:
        return []
    seed = [r for _, r in returns[:init_n]]
    mean = sum(seed) / len(seed)
    var = sum((r - mean) ** 2 for r in seed) / (len(seed) - 1)
    out = []
    for i, (d, r) in enumerate(returns):
        if i < init_n:
            out.append((d, math.sqrt(var)))   # burn-in: seed variance
            continue
        var = lam * var + (1.0 - lam) * r * r
        out.append((d, math.sqrt(var)))
    return out


def percentile(sorted_vals, q):
    """Linear-interpolated percentile, q in [0,1], on a pre-sorted list."""
    n = len(sorted_vals)
    if n == 0:
        raise ValueError("empty")
    if n == 1:
        return sorted_vals[0]
    pos = q * (n - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def trend_score(series, idx, lookbacks=(21, 63, 126, 252)):
    """Multi-lookback standardised trend at series[idx].

    Per lookback L: (sum of last L daily log returns) divided by
    (std of those returns * sqrt(L)). Averaged across lookbacks.
    Returns (score, {L: z_L}) or (None, {}) if history is short."""
    if idx + 1 < max(lookbacks) + 1:
        return None, {}
    comps = {}
    for L in lookbacks:
        rs = []
        for i in range(idx - L + 1, idx + 1):
            p0, p1 = series[i - 1][1], series[i][1]
            rs.append(math.log(p1 / p0))
        m = sum(rs) / L
        var = sum((r - m) ** 2 for r in rs) / (L - 1)
        sd = math.sqrt(var)
        if sd <= 0:
            return None, {}
        comps[L] = sum(rs) / (sd * math.sqrt(L))
    score = sum(comps.values()) / len(comps)
    return score, comps


def range_position(series, idx, window=252):
    """Where the close sits in its trailing 252-observation range, 0..1."""
    if idx + 1 < window:
        return None
    win = [c for _, c in series[idx - window + 1: idx + 1]]
    lo, hi = min(win), max(win)
    if hi <= lo:
        return None
    return (series[idx][1] - lo) / (hi - lo)


# ---------------------------------------------------------------- stance

# Frozen v1 thresholds - global across instruments, changed only by a
# signed-off change to config/range_params.json.
STANCE_PARAMS = {
    "trend_hold": 0.40,       # S >= +0.40 -> Hold (uptrend expected to continue)
    "trend_wait": -0.40,      # S <= -0.40 -> Wait (falling, no base)
    "pos_low": 0.15,          # bottom zone of the 252d range
    "pos_high": 0.85,         # top zone of the 252d range
}


def derive_stance(score, z_short, pos, params=STANCE_PARAMS):
    """Mechanical stance from the computed signals. Order matters.

    Buy  = bottom of the 252d range AND short-term momentum turned up.
    Sell = top of the 252d range AND short-term momentum turned down.
    Hold = composite uptrend.  Wait = composite downtrend.  Flat = neither.
    (No-read and No-data are decided by the pipeline, not by signals.)
    """
    if score is None or z_short is None or pos is None:
        return None
    if pos <= params["pos_low"] and z_short > 0:
        return "Buy"
    if pos >= params["pos_high"] and z_short < 0:
        return "Sell"
    if score >= params["trend_hold"]:
        return "Hold"
    if score <= params["trend_wait"]:
        return "Wait"
    return "Flat"


def stance_direction(stance):
    return {"Buy": 1, "Hold": 1, "Sell": -1, "Wait": -1}.get(stance, 0)


def flip_level(series, idx, params=STANCE_PARAMS, max_move=0.5):
    """The nearest NEXT close that would put the stance in a different bucket
    from TODAY'S stance, found by bisection on a hypothetical appended close.

    Appending any close - even an unchanged price - shifts every lookback
    window, so a marginal stance can flip with no price move at all
    (momentum decay). That is real and is reported honestly: the flip level
    is then the current price itself. Returns (price, new_stance) or
    (None, None) if nothing within +/-max_move flips it."""
    date0, p0 = series[idx]
    s_now, comps_now = trend_score(series, idx)
    pos_now = range_position(series, idx)
    base = derive_stance(s_now, comps_now.get(21) if comps_now else None,
                         pos_now, params)
    if base is None:
        return None, None

    st0 = _stance_with_next(series, idx, p0)
    if st0 is not None and st0 != base:
        return p0, st0

    best = None
    for direction in (1, -1):
        lo_f, hi_f = 0.0, max_move
        s_hi = _stance_with_next(series, idx, p0 * (1 + direction * hi_f))
        if s_hi is None or s_hi == base:
            continue
        for _ in range(40):
            mid = (lo_f + hi_f) / 2
            s_mid = _stance_with_next(series, idx, p0 * (1 + direction * mid))
            if s_mid is not None and s_mid != base:
                hi_f, s_hi = mid, s_mid
            else:
                lo_f = mid
        cand = (p0 * (1 + direction * hi_f), s_hi)
        if best is None or abs(cand[0] - p0) < abs(best[0] - p0):
            best = cand
    return best if best else (None, None)


def _stance_with_next(series, idx, next_price):
    ext = series[: idx + 1] + [(series[idx][0] + dt.timedelta(days=1), next_price)]
    j = len(ext) - 1
    s, comps = trend_score(ext, j)
    pos = range_position(ext, j)
    z = comps.get(21) if comps else None
    return derive_stance(s, z, pos)


# ---------------------------------------------------------------- intervals

def interval_from_quantiles(price, sigma_daily, steps, q10, q90):
    """80% prediction interval for the close `steps` observations ahead."""
    s = sigma_daily * math.sqrt(max(steps, 1))
    return price * math.exp(q10 * s), price * math.exp(q90 * s)


def interval_score(lo, hi, x, alpha=0.2):
    """Gneiting & Raftery (2007) interval score, log-price space."""
    width = hi - lo
    pen = 0.0
    if x < lo:
        pen = (2.0 / alpha) * (lo - x)
    elif x > hi:
        pen = (2.0 / alpha) * (x - hi)
    return width + pen


def phi(x):
    """Standard normal CDF via erf - used only to MAP a signal to a
    probability for Brier scoring, never to set interval widths."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


# ---------------------------------------------------------------- calendar

def iso_week(d):
    y, w, _ = d.isocalendar()
    return "%04d-W%02d" % (y, w)


def friday_of_week(d):
    """The Friday of d's ISO week."""
    return d + dt.timedelta(days=4 - d.isocalendar()[2])


def last_index_on_or_before(series, target):
    """Index of the last row with date <= target, or None."""
    lo, hi, ans = 0, len(series) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= target:
            ans = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return ans


# ---------------------------------------------------------------- stats

def christoffersen_independence(hits):
    """LR test of independence of interval misses (Christoffersen 1998).
    hits: list of 0/1 (1 = inside). Returns (LR, p_value) or (None, None)."""
    n = {}
    for a, b in zip(hits, hits[1:]):
        n[(a, b)] = n.get((a, b), 0) + 1
    n00, n01 = n.get((0, 0), 0), n.get((0, 1), 0)
    n10, n11 = n.get((1, 0), 0), n.get((1, 1), 0)
    if (n00 + n01) == 0 or (n10 + n11) == 0:
        return None, None
    p01 = n01 / (n00 + n01)
    p11 = n11 / (n10 + n11)
    p = (n01 + n11) / (n00 + n01 + n10 + n11)

    def ll(k, n_, pr):
        if pr <= 0 or pr >= 1:
            return 0.0
        return k * math.log(pr) + (n_ - k) * math.log(1 - pr)

    l0 = ll(n01 + n11, n00 + n01 + n10 + n11, p)
    l1 = ll(n01, n00 + n01, p01) + ll(n11, n10 + n11, p11)
    lr = max(0.0, -2.0 * (l0 - l1))
    # chi-square df=1 survival: P(X > lr) = 1 - erf(sqrt(lr/2))
    pval = 1.0 - math.erf(math.sqrt(lr / 2.0))
    return lr, pval


def block_bootstrap_mean(values, block=8, n_boot=1000, seed=20260821, fn=None):
    """Circular block bootstrap of the mean (or fn) of a sequence.
    Returns (lo95, hi95)."""
    import random
    if not values:
        return None, None
    rng = random.Random(seed)
    n = len(values)
    stats = []
    for _ in range(n_boot):
        sample = []
        while len(sample) < n:
            start = rng.randrange(n)
            for k in range(block):
                sample.append(values[(start + k) % n])
        sample = sample[:n]
        stats.append(fn(sample) if fn else sum(sample) / n)
    stats.sort()
    return percentile(stats, 0.025), percentile(stats, 0.975)


# ---------------------------------------------------------------- garch

def garch_fit(returns, a_grid=None, b_grid=None):
    """Variance-targeted GARCH(1,1) by grid-searched Gaussian QMLE.
    returns: list of daily log returns. Returns (omega, alpha, beta, ll)."""
    rs = list(returns)
    n = len(rs)
    if n < 300:
        raise ValueError("too few observations for GARCH")
    mean = sum(rs) / n
    uncond = sum((r - mean) ** 2 for r in rs) / (n - 1)
    a_grid = a_grid or [x / 100.0 for x in range(2, 21, 2)]
    b_grid = b_grid or [x / 100.0 for x in range(70, 98, 2)]
    best = None
    for a in a_grid:
        for b in b_grid:
            if a + b >= 0.995:
                continue
            w = uncond * (1.0 - a - b)
            var = uncond
            ll = 0.0
            ok = True
            for r in rs:
                if var <= 0:
                    ok = False
                    break
                ll += -0.5 * (math.log(var) + r * r / var)
                var = w + a * r * r + b * var
            if ok and (best is None or ll > best[3]):
                best = (w, a, b, ll)
    if best is None:
        raise ValueError("GARCH grid found nothing")
    return best


def garch_vol_path(returns, omega, alpha, beta, init_n=252):
    """Per-date one-step-ahead-usable volatility under fitted GARCH params.
    Entry i uses r_i and earlier, like ewma_vol_path. The recursion seeds
    from the FIRST init_n observations only (past-only; entries inside the
    seed window carry it and must not be used for forecasts - the drivers
    enforce a min index)."""
    seed = [r for _, r in returns[:init_n]]
    mean = sum(seed) / len(seed)
    var = sum((r - mean) ** 2 for r in seed) / (len(seed) - 1)
    out = []
    for d, r in returns:
        var = omega + alpha * r * r + beta * var
        out.append((d, math.sqrt(var)))
    return out
