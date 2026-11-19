// Wallet Intelligence / Funding Trace benchmark for a SYNCRONIX endpoint.
//
//   node harness/wallet-intel.mjs --wallets wallets.local.json [--base URL] [--out results/wallet-run.json]
//
// wallets file: JSON array of { "network": "mainnet" | "testnet", "address": "0x…" }.
// Read-only and free: it calls GET /api/chain/wallet (intel + trace) and GET /api/chain/analyze, which returns the
// AI cost ESTIMATE only. It never sends POST /api/chain/analyze, so no AI model is ever called.
// Published results replace addresses with W1, W2, … (use --keep-addresses for a private run).
// Requires Node.js 18+ (built-in fetch). No dependencies.
import fs from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const BASE = arg("base", "http://localhost:3100").replace(/\/$/, "");
const WALLETS = JSON.parse(fs.readFileSync(arg("wallets", "wallets.local.json"), "utf8"));
const OUT = arg("out", `results/wallet-run-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.json`);
const KEEP = process.argv.includes("--keep-addresses");
// Explorer hosts the service is expected to link to, per network.
const EXPLORER = { mainnet: "robin.etherscan.io", testnet: "explorer.testnet.chain.robinhood.com" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const t0 = performance.now();
  const r = await fetch(BASE + path);
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, ms, body, text };
}

// Every URL in a response, and whether each points at the expected explorer.
function links(text, net) {
  const urls = text.match(/https?:\/\/[^"\s]+/g) || [];
  const ok = urls.filter((u) => new URL(u).host === EXPLORER[net]).length;
  return { total: urls.length, onExplorer: ok };
}
// The response must never carry an indexer API key or a key-like query parameter.
const leaks = (text) => /apikey|api_key|x-api-key/i.test(text);

const rows = [];
for (const [i, w] of WALLETS.entries()) {
  const id = KEEP ? w.address : `W${i + 1}`;
  const net = w.network === "testnet" ? "testnet" : "mainnet";
  const q = `network=${net}&address=${w.address}`;
  const row = { wallet: id, network: net };

  const a = await get(`/api/chain/wallet?${q}&view=intel`);
  const a2 = await get(`/api/chain/wallet?${q}&view=intel`); // within the 60 s cache
  if (a.status !== 200) row.intel = { status: a.status, error: a.body?.error };
  else {
    const c = a.body.coverage;
    row.intel = {
      ms: a.ms, repeatMs: a2.ms, repeatCached: !!a2.body?.cached,
      transactions: c.transactions, transactionsComplete: c.transactionsComplete,
      internalTransfers: c.internalTransfers, internalPending: !!c.internalPending,
      contracts: a.body.contracts.length, counterparties: a.body.counterparties.length, tokens: a.body.tokens.length,
      rpcCrossCheck: a.body.crossCheck ? (a.body.crossCheck.ok ? "matched" : `mismatch: ${a.body.crossCheck.reason}`) : "none",
      indexerCalls: a.body.source?.indexerCalls ?? null,
      links: links(a.text, net), keyLeak: leaks(a.text),
    };
  }

  const t = await get(`/api/chain/wallet?${q}&view=trace`);
  if (t.status !== 200) row.trace = { status: t.status, error: t.body?.error };
  else {
    const edges = t.body.graph?.edges || [];
    const by = (f) => edges.reduce((m, e) => ((m[f(e)] = (m[f(e)] || 0) + 1), m), {});
    row.trace = {
      ms: t.ms, cached: !!t.body.cached, hops: t.body.steps.length, stop: t.body.stop,
      firstFunderProven: !!t.body.proven, firstFunderKind: t.body.steps[0]?.kind ?? null,
      firstFunderVerifiedBy: t.body.steps[0]?.verifiedBy ?? null,
      graph: { nodes: t.body.graph?.nodes?.length || 0, edges: edges.length, evidence: by((e) => e.evidence), verifiedBy: by((e) => e.verifiedBy || "inferred") },
      sharedFunder: t.body.shared ? { sampled: t.body.shared.sampled, distinctRecipients: t.body.shared.distinctRecipients, hub: t.body.shared.hub } : null,
      indexerCalls: t.body.source?.indexerCalls ?? null, cachedCalls: t.body.source?.cachedCalls ?? null,
      links: links(t.text, net), keyLeak: leaks(t.text),
    };
  }

  const e = await get(`/api/chain/analyze?${q}`); // estimate only: no model call
  row.aiEstimate = e.status === 200
    ? { ms: e.ms, model: e.body.model, inputTokens: e.body.inputTokens, estimatedUsd: e.body.estimatedUsd, maxUsd: e.body.maxUsd, reserveUsd: e.body.reserveUsd, factLines: e.body.facts?.lines, factLinks: e.body.facts?.links }
    : { status: e.status, error: e.body?.error };

  rows.push(row);
  const it = row.intel, tr = row.trace;
  console.log(`${id} ${net}: intel ${it.ms ?? it.status}ms (${it.transactions ?? "-"} tx, cross-check ${it.rpcCrossCheck ?? "-"}) · trace ${tr.ms ?? tr.status}ms ${tr.hops ?? "-"} hop(s), stop ${tr.stop ?? tr.error} · AI estimate $${row.aiEstimate.estimatedUsd ?? "-"} (max $${row.aiEstimate.maxUsd ?? "-"})`);
  await sleep(11_000); // stay under the public limit of 6 traces per minute
}

const ok = rows.filter((r) => r.trace?.ms);
const summary = {
  wallets: rows.length,
  allLinksOnExplorer: rows.every((r) => [r.intel, r.trace].every((x) => !x?.links || x.links.total === x.links.onExplorer)),
  keyLeaks: rows.filter((r) => r.intel?.keyLeak || r.trace?.keyLeak).length,
  rpcCrossCheckMatched: `${rows.filter((r) => r.intel?.rpcCrossCheck === "matched").length}/${rows.filter((r) => r.intel?.rpcCrossCheck && r.intel.rpcCrossCheck !== "none").length}`,
  traceMs: ok.length ? { min: Math.min(...ok.map((r) => r.trace.ms)), max: Math.max(...ok.map((r) => r.trace.ms)) } : null,
  aiCalls: 0,
};
fs.mkdirSync(OUT.split(/[\\/]/).slice(0, -1).join("/") || ".", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), summary, rows }, null, 2) + "\n");
console.log(`\n${JSON.stringify(summary)}\nwrote ${OUT}`);
