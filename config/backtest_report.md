# Range backtest report - 2026-08-20T22:36:15Z

Selected vol model: **ewma94** | Gate verdict: **PASS** | Trend weight: **0.0**

| instrument | 1w n | 1w cov | 1w IS | 1m cov | eoy cov | Christ. p |
|---|---|---|---|---|---|---|
| gold | 369 | 0.8076 | 0.088193 | 0.7816 | 0.7654 | 0.003 |
| silver | 369 | 0.7805 | 0.189959 | 0.7767 | 0.6676 | 0.6207 |
| wti | 368 | 0.7908 | 0.212436 | 0.8134 | 0.9494 | 0.235 |
| btc | 385 | 0.8104 | 0.328288 | 0.7852 | 0.6676 | 0.569 |
| spx | 369 | 0.794 | 0.081809 | 0.8263 | 0.8095 | 0.5854 |
| ndx | 369 | 0.7859 | 0.103147 | 0.804 | 0.8263 | 0.7489 |
| dxy | 368 | 0.7962 | 0.0343 | 0.7836 | 0.6742 | 0.5281 |

Pooled (ewma94): {"1w": {"n": 2597, "coverage": 0.7951, "mean_interval_score": 0.149432}, "1m": {"n": 2835, "coverage": 0.7958, "mean_interval_score": 0.308991}, "eoy": {"n": 2515, "coverage": 0.765, "mean_interval_score": 0.790236}}

Gates: {"G1_pooled_1w_coverage_76_84": {"value": 0.7951, "pass": true}, "G2_per_instrument_70_90": {"count_in_band": 7, "pass": true}, "G3_christoffersen_info_only": {"instruments_independent_at_5pct": 6}, "verdict": "PASS"}

Trend (1m, pooled verdict): {"instruments_sig_better": 0, "instruments_dir_beats_base": 1, "earned_weight": 0.0}

Stance hit rates (1w, pooled): {"Buy": {"n": 57, "hit_rate": 0.4737}, "Flat": {"n": 797, "hit_rate": 0.793}, "Hold": {"n": 1227, "hit_rate": 0.5827}, "Sell": {"n": 123, "hit_rate": 0.4472}, "Wait": {"n": 393, "hit_rate": 0.4377}}

Provenance: {"gold": {"source": "lbma", "symbol": "gold_pm", "fetched_utc": "2026-08-20T22:36:10Z", "rows": 2512, "first": "2016-08-11", "last": "2026-08-19"}, "silver": {"source": "lbma", "symbol": "silver", "fetched_utc": "2026-08-20T22:36:10Z", "rows": 2532, "first": "2016-08-11", "last": "2026-08-19"}, "wti": {"source": "yahoo", "symbol": "CL=F", "fetched_utc": "2026-08-20T22:36:11Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20", "nonpositive_rows_dropped": 1}, "btc": {"source": "yahoo", "symbol": "BTC-USD", "fetched_utc": "2026-08-20T22:36:12Z", "rows": 3653, "first": "2016-08-20", "last": "2026-08-20"}, "spx": {"source": "yahoo", "symbol": "^GSPC", "fetched_utc": "2026-08-20T22:36:13Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20"}, "ndx": {"source": "yahoo", "symbol": "^NDX", "fetched_utc": "2026-08-20T22:36:14Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20"}, "dxy": {"source": "yahoo", "symbol": "DX-Y.NYB", "fetched_utc": "2026-08-20T22:36:15Z", "rows": 2513, "first": "2016-08-22", "last": "2026-08-20"}}
