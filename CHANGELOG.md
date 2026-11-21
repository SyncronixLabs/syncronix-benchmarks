# Changelog

Harnesses and results added or changed in this repository, newest first. Dates are UTC.

## 2026-11-21

- Added the official $SNX contract address (Robinhood Chain mainnet) to the README.
- Added `harness/api-conformance.mjs`: 30 documented refusals and same-site checks against the live API, free and
  without side effects. Result on production: 30/30 (`results/2026-11-21-api-conformance.json`).
- Added `harness/fee-headroom.mjs` and `harness/fee-spike.mjs`: base fee and gas estimate movement within a 60 s
  transfer preview, from the official Robinhood Chain RPC only. Results for mainnet and testnet, plus two mainnet
  spikes at full resolution (`results/2026-11-21-fee-*.json`).

## 2026-11-20

- Updated the release references to the current commit hashes of the production repository.

## 2026-11-19

- Added the Wallet Intelligence harness (`harness/wallet-intel.mjs`) and production results for 5 addresses
  (`results/2026-11-19-wallet-intel.json`).

## 2026-11-13

- Added the research-quality harness (`harness/research-quality.mjs`), task sets and measured results
  (`results/2026-11-13-research-quality.json`).
