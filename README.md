<p align="center">
  <img src="https://raw.githubusercontent.com/SyncronixLabs/SyncronixLabs/main/assets/syncronix-banner.jpg" alt="SYNCRONIX" width="100%">
</p>

<h1 align="center">SYNCRONIX Benchmarks</h1>

<p align="center">
  Does the research agent actually read and cite its sources, is wallet data verified, and what does each run cost?<br>
  <a href="https://syncronixai.xyz">Website</a> · <a href="https://github.com/SyncronixLabs/syncronix-docs">Docs</a> · <a href="https://github.com/SyncronixLabs/syncronix-research">Research</a>
</p>

---

## Research quality

### What is measured

```mermaid
flowchart LR
    T["tasks/*.json"] --> H["harness/<br/>research-quality.mjs"]
    H -->|"POST /api/runs<br/>(billed run)"| S["SYNCRONIX<br/>endpoint"]
    S ==>|"Server-Sent Events"| H
    H --> R["results/*.json<br/>+ console table"]
    classDef default fill:#111111,stroke:#3a3a3a,color:#F5F3EE
    style S fill:#1a0f08,stroke:#FF681B,color:#F5F3EE
```

| Metric | Definition |
|---|---|
| **Pages read** | Distinct pages successfully fetched and read in full (not search snippets) |
| **Findings citing a read page** | Bullets under *Findings* that link to at least one page that was read |
| **Unsourced findings** | Findings with no link |
| **Single-source findings** | Findings the agent marked *(single source)* |
| **Cited passages** | Passage-level citations the API attached to the report text |
| **Sources traced** | Report links that trace to a real search result or fetched page / all report links |
| **Repeated searches / fetches** | Identical queries or pages issued more than once in a run |
| **Cost** | List-price estimate from API-reported token usage plus search fees |
| **Within ceiling** | Cost ≤ the per-run ceiling ($0.20) |

### Latest results

*13 Nov 2026 · claude-sonnet-5-5 · local build of the production agent*

| Configuration | Task | Pages read | Findings citing a read page | Repeats | Cited passages | Cost |
|---|---|---|---|---|---|---|
| Baseline (production) | similar to T1 | 0 | — | 1 search | — | $0.082 |
| Protocol + dynamic-filtering tools | T1 | 3 | 5/5 | 3 searches + fetches | 0 | $0.106 |
| Protocol + dynamic-filtering tools | T2 | 2 | 1/4 | fetches | 0 | $0.085 |
| **Protocol + direct-call tools (current)** | T1 | 2 | 6/8 | none | 17 | **$0.069** |
| **Protocol + direct-call tools (current)** | T2 | 2 | 5/5 | none | 2 | **$0.040** |

**T1** — *How does Solana's Proof of History work, and is it being replaced?*
**T2** — *What is the current Node.js Active LTS release line and when does it reach end of life?*

> [!IMPORTANT]
> Single runs of two tasks. Treat the results as directional, not as statistically established.
> Raw data: [results/2026-11-13-research-quality.json](results/2026-11-13-research-quality.json) ·
> analysis: [syncronix-research](https://github.com/SyncronixLabs/syncronix-research/blob/main/notes/2026-11-grounded-web-research.md).

### Run the benchmark

Node.js 18+, no dependencies. **Each task starts one billed research run** on the server you point it at.

```bash
# a self-hosted SYNCRONIX instance
node harness/research-quality.mjs --base http://localhost:3100

# the public service: one run per visitor per day, so use a single task
node harness/research-quality.mjs --base https://syncronixai.xyz --tasks tasks/one.json
```

<details>
<summary><b>Options</b></summary>

| Option / variable | Default | Meaning |
|---|---|---|
| `--base` | `http://localhost:3100` | Endpoint to test |
| `--tasks` | `tasks/default.json` | JSON array of task strings |
| `--out` | `results/run-<timestamp>.json` | Where to write results |
| `SYNCRONIX_ADMIN_KEY` | — | Admin key of your own instance (lifts the per-visitor daily limit there) |
| `RUN_CEILING_USD` | `0.20` | Ceiling used for the *within ceiling* check |

</details>

<details>
<summary><b>Result file format</b></summary>

```json
{
  "base": "http://localhost:3100",
  "ranAt": "2026-11-13T04:50:00.000Z",
  "ceilingUsd": 0.2,
  "rows": [
    {
      "task": "…",
      "seconds": 23,
      "costUsd": 0.06853,
      "searches": 2,
      "repeatedSearches": 0,
      "pagesRead": 2,
      "repeatedFetches": 0,
      "findings": 8,
      "findingsCitingReadPage": 6,
      "unsourcedFindings": 0,
      "singleSourceFindings": 0,
      "citedPassages": 17,
      "sourcesTraced": "7/7",
      "withinCeiling": true,
      "notes": ["Source check: …", "Grounding: …"]
    }
  ]
}
```

A run refused before it starts records `refused`; a run that fails records `failed`.

</details>

## Wallet Intelligence benchmark

Does Wallet Intelligence return verified, cross-checked data, how fast, and what would an AI brief cost?
The harness is **read-only and free**: it calls the Activity and Funding-trace endpoints and the AI *estimate*, and
never starts an AI analysis.

| Metric | Definition |
|---|---|
| **Activity / trace time** | Wall-clock time of the API response, first request and repeat |
| **RPC cross-check** | The newest indexed transaction re-read from the official RPC: sender, recipient and value match |
| **First funder proven** | The indexer's internal-transfer history up to the first inflow was complete |
| **Evidence** | Graph edges labelled `verified` (an on-chain transfer) vs. `inferred` (a shared-funder pattern) |
| **Links on explorer** | Response URLs that point to Robinscan (mainnet) or the testnet explorer |
| **Key leaks** | Responses containing an API-key parameter (must be 0) |
| **AI estimate** | Estimated and maximum cost shown before a visitor may click *Analyze with AI* |

### Latest results

*19 Nov 2026 · production (release e73d8c5) · 4 mainnet + 1 testnet address · 0 AI calls*

| Wallet | Activity (first / cached) | Trace | Hops · stop | First funder | Graph edges | AI estimate (max) |
|---|---|---|---|---|---|---|
| W1 mainnet | 4.7 s / 0.42 s | 0.41 s (cached) | 5 · contract | earliest found, `rpc` | 5 verified | $0.00114 ($0.00202) |
| W2 mainnet | 5.8 s / 0.46 s | 1.7 s | 4 · contract | earliest found, `rpc` | 4 verified | $0.00120 ($0.00209) |
| W3 mainnet | 4.5 s / 0.66 s | 1.9 s | 5 · contract | earliest found, `rpc` | 5 verified | $0.00117 ($0.00206) |
| W4 mainnet | 4.2 s / 0.40 s | 1.9 s | 5 · contract | earliest found, `rpc` | 5 verified | $0.00114 ($0.00202) |
| W5 testnet | 4.0 s / 0.67 s | 7.6 s | 5 · max_hops | **proven**, `rpc` | 11 verified, 6 inferred | $0.00124 ($0.00215) |

RPC cross-check matched **5/5** · links on the expected explorer **379/379** · key leaks **0**.

> [!IMPORTANT]
> Five addresses, one run each. W1's trace was served from cache, and W2–W4 share upstream funders with W1, so their
> traces reused cached hops. Mainnet first funders show as *earliest found* because the indexer reports some mainnet
> internal transactions as still processing. Addresses are replaced with W1–W5 in published results.
> Raw data: [results/2026-11-19-wallet-intel.json](results/2026-11-19-wallet-intel.json) ·
> analysis: [syncronix-research](https://github.com/SyncronixLabs/syncronix-research/blob/main/notes/2026-11-wallet-funding-trace.md).

Measured AI briefs (two runs during release testing, outside this harness): **$0.0013** and **$0.0014**, 6–7 s.

### Run it

```bash
# wallets.local.json: [{ "network": "mainnet", "address": "0x…" }, …]   (git-ignored)
node harness/wallet-intel.mjs --wallets wallets.local.json --base https://syncronixai.xyz
```

| Option | Default | Meaning |
|---|---|---|
| `--wallets` | `wallets.local.json` | JSON array of `{ network, address }` |
| `--base` | `http://localhost:3100` | Endpoint to test |
| `--out` | `results/wallet-run-<timestamp>.json` | Where to write results |
| `--keep-addresses` | off | Keep real addresses in the output instead of W1, W2, … |

The harness waits 11 s between addresses to stay under the public limit of 6 funding traces per minute.

## Repository layout

```
harness/research-quality.mjs   the research benchmark runner (streams and scores each run)
harness/wallet-intel.mjs       the wallet benchmark runner (read-only, no AI calls)
tasks/default.json             two-task set used for the published results
tasks/one.json                 single task for the public service
results/                       published results (JSON, wallet addresses replaced by W1, W2, …)
```

<sub>Licensed under the [MIT License](LICENSE).</sub>
