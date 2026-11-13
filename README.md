# SYNCRONIX Benchmarks

Measures whether the SYNCRONIX Research Agent actually reads and cites its sources, and what each run costs.

## Metrics

| Metric | Definition |
|---|---|
| Pages read | Distinct pages successfully fetched and read in full (not search snippets) |
| Findings citing a read page | Bullets under *Findings* that link to at least one page that was read |
| Unsourced findings | Findings with no link |
| Single-source findings | Findings the agent marked *(single source)* |
| Cited passages | Passage-level citations the API attached to the report text |
| Sources traced | Report links that trace to a real search result or fetched page / all report links |
| Repeated searches / fetches | Identical queries or pages issued more than once in a run |
| Cost | List-price estimate from API-reported token usage plus search fees |
| Within ceiling | Cost ≤ the per-run ceiling ($0.20) |

## Latest results (13 Nov 2026, claude-sonnet-5-5)

| Configuration | Task | Pages read | Findings citing a read page | Repeats | Cited passages | Cost |
|---|---|---|---|---|---|---|
| Baseline (production) | similar to T1 | 0 | — | 1 search | — | $0.082 |
| Protocol + dynamic-filtering tools | T1 | 3 | 5/5 | 3 searches + fetches | 0 | $0.106 |
| Protocol + dynamic-filtering tools | T2 | 2 | 1/4 | fetches | 0 | $0.085 |
| **Protocol + direct tools (current)** | T1 | 2 | 6/8 | none | 17 | **$0.069** |
| **Protocol + direct tools (current)** | T2 | 2 | 5/5 | none | 2 | **$0.040** |

Raw data: [results/2026-11-13-research-quality.json](results/2026-11-13-research-quality.json).
Analysis: [syncronix-research](https://github.com/SyncronixLabs/syncronix-research/blob/main/notes/2026-11-grounded-web-research.md).
These are single runs of two tasks; treat them as directional.

## Run it

Node.js 18+, no dependencies. Each task starts one **billed** research run on the server you point it at.

```bash
node harness/research-quality.mjs --base http://localhost:3100            # a self-hosted instance
node harness/research-quality.mjs --base https://syncronixai.xyz --tasks tasks/one.json
```

The public service allows one run per visitor per day, so against it use a single task. Edit `tasks/default.json`
for your own task set. Results are written to `results/`.

Licensed under the [MIT License](LICENSE).
