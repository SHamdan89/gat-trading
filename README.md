# gat.trading

Public asset pricing + a daily market brief. Static site, no build step.

- `data/` — the historical database (append-only CSV plus generated JSON),
  written hourly by a launchd job on the isolated `gat.room` account
  (a run that finds nothing moved commits nothing).
- `data/brief/` — the daily brief, validated before publish.
- The page reads `data/latest.json` and `data/brief/latest.json`.
  It never calls a price API per visitor.

## Editing the CSS or JS? Bump the version query.

`index.html` loads `assets/style.css?v=N` and `assets/app.js?v=N`.
**Increment N whenever either file changes.** Without it, returning
visitors get new HTML paired with a cached old stylesheet — the page
renders broken for them while looking correct to anyone with a cold
cache. Data files are already cache-busted per request and need nothing.
