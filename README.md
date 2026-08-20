# gat.trading

Public asset pricing + daily market brief. Static site, no build step.

- `data/` — the historical database (append-only CSV + generated JSON snapshots), written daily by a cron on the isolated `gat.room` account.
- Site reads `data/latest.json`. It never calls a price API per visitor.

Status: scaffold. Nothing published yet.
