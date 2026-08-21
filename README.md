# gat.trading

Public asset pricing + a daily market brief. Static site, no build step.

- `data/` — the historical database (append-only CSV plus generated JSON),
  written hourly by a scheduled job on an isolated build account
  (a run that finds nothing moved commits nothing).
- `data/brief/` — the daily brief, validated before publish.
- `data/weekly/` — the Weekly Review. Files here are written once and
  **never edited**: a forecast is stored before the period it covers and
  scored afterwards, and that is the whole point of the record.
- `bin/` — the deterministic engine. `gatlib.py` holds the one copy of every
  formula; `backtest_ranges.py` validates those same functions walk-forward;
  `weekly_forecast.py` produces every published number. `config/` holds the
  frozen parameters the backtest selected.
- The page reads `data/latest.json`, `data/brief/latest.json` and
  `data/weekly/latest.json`. It never calls a price API per visitor.

## Editing the CSS or JS? Bump the version query.

`index.html` loads `assets/style.css?v=N` and `assets/app.js?v=N`.
**Increment N whenever either file changes.** Without it, returning
visitors get new HTML paired with a cached old stylesheet — the page
renders broken for them while looking correct to anyone with a cold
cache. Data files are already cache-busted per request and need nothing.
