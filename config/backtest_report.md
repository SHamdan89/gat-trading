# Range backtest report - 2026-08-21T01:24:25Z

Selected vol model: **ewma94** | Gate verdict: **PASS** | Trend weight: **0.0**

| instrument | 1w n | 1w cov | 1w IS | 1m cov | eoy cov | Christ. p |
|---|---|---|---|---|---|---|
| gold | 369 | 0.8076 | 0.081762 | 0.7692 | 0.7423 | 0.1607 |
| silver | 369 | 0.8022 | 0.175682 | 0.804 | 0.6863 | 0.2584 |
| wti | 367 | 0.8065 | 0.218761 | 0.8429 | 0.969 | 0.4631 |
| btc | 384 | 0.8125 | 0.322214 | 0.7919 | 0.6971 | 0.4171 |
| spx | 368 | 0.7962 | 0.082672 | 0.8408 | 0.8511 | 0.3609 |
| ndx | 368 | 0.7826 | 0.100943 | 0.8085 | 0.8624 | 0.0829 |
| dxy | 367 | 0.812 | 0.033654 | 0.7706 | 0.6563 | 0.2917 |

Pooled (ewma94): {"1w": {"n": 2592, "coverage": 0.8029, "mean_interval_score": 0.146193}, "1m": {"n": 2830, "coverage": 0.8039, "mean_interval_score": 0.313432}, "eoy": {"n": 2509, "coverage": 0.78, "mean_interval_score": 0.79929}}

Gates: {"G1_pooled_1w_coverage_76_84": {"value": 0.8029, "pass": true}, "G2_per_instrument_70_90": {"count_in_band": 7, "pass": true}, "G3_christoffersen_info_only": {"instruments_independent_at_5pct": 7}, "verdict": "PASS"}

Trend (1m, pooled verdict): {"instruments_sig_better": 0, "instruments_dir_beats_base": 2, "earned_weight": 0.0}

Stance hit rates (1w, pooled): {"Buy": {"n": 45, "hit_rate": 0.5111}, "Flat": {"n": 795, "hit_rate": 0.8038}, "Hold": {"n": 1236, "hit_rate": 0.5688}, "Sell": {"n": 110, "hit_rate": 0.4636}, "Wait": {"n": 406, "hit_rate": 0.4458}}

Provenance: {"gold": {"source": "lbma", "symbol": "gold_pm", "fetched_utc": "2026-08-20T22:36:10Z", "rows": 2512, "first": "2016-08-11", "last": "2026-08-19"}, "silver": {"source": "lbma", "symbol": "silver", "fetched_utc": "2026-08-20T22:36:10Z", "rows": 2532, "first": "2016-08-11", "last": "2026-08-19"}, "wti": {"source": "yahoo", "symbol": "CL=F", "fetched_utc": "2026-08-20T22:36:11Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20", "nonpositive_rows_dropped": 1}, "btc": {"source": "yahoo", "symbol": "BTC-USD", "fetched_utc": "2026-08-20T22:36:12Z", "rows": 3653, "first": "2016-08-20", "last": "2026-08-20"}, "spx": {"source": "yahoo", "symbol": "^GSPC", "fetched_utc": "2026-08-20T22:36:13Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20"}, "ndx": {"source": "yahoo", "symbol": "^NDX", "fetched_utc": "2026-08-20T22:36:14Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20"}, "dxy": {"source": "yahoo", "symbol": "DX-Y.NYB", "fetched_utc": "2026-08-20T22:36:15Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20"}}
