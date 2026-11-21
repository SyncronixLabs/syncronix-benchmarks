// API conformance check for a SYNCRONIX endpoint: does the live service refuse what the docs say it refuses?
//
//   node harness/api-conformance.mjs [--base https://syncronixai.xyz] [--out results/api-conformance.json]
//                                    [--from 0x… --to 0x…]   (optional: also check one successful transfer preview)
//
// Free and side-effect free:
//   - Transfer cases call POST /api/chain/execute, which only PREVIEWS a transfer (it never signs or sends).
//     Every case is refused before any chain read, except the optional successful preview.
//   - Cross-site cases send an Origin from another website; the server refuses them before anything else runs.
//     The bodies sent there are also invalid, so no research run or AI analysis could start even if they were accepted.
//   - No research run, no AI call, no wallet, no key.
// Requests are paced (default 2.5 s) to stay under the 30 chain lookups per minute per visitor.
// Requires Node.js 18+ (built-in fetch). No dependencies.
import fs from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const BASE = arg("base", "https://syncronixai.xyz").replace(/\/$/, "");
const OUT = arg("out", `results/api-conformance-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.json`);
const PACE_MS = Number(arg("pace", "2500"));
const QUOTE_FROM = arg("from", null);
const QUOTE_TO = arg("to", null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Well-known placeholder addresses (valid format; used only as request inputs). 0x5290…EE7 is the EIP-55 test vector
// with one letter's case flipped.
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const BAD_SUM = "0x52908400098527886e0F7030069857D2E4169EE7";
const ZERO = "0x0000000000000000000000000000000000000000";

async function call(method, path, { body, headers = {}, raw } = {}) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, ms, json, cors: r.headers.get("access-control-allow-origin") };
}

const X = "/api/chain/execute";
const tx = (network, text) => ({ network, from: A, text });
// [name, method, path, request options, expected status, expected `error` code]
const CASES = [
  // Transfer instruction rules (docs: wallet-transfers.md, api.md)
  ["over the mainnet cap (0.05 ETH)", "POST", X, { body: tx("mainnet", `Send 1 ETH to ${B}`) }, 400, "over_limit"],
  ["over the testnet cap (1 ETH)", "POST", X, { body: tx("testnet", `Send 2 ETH to ${B} on testnet`) }, 400, "over_limit"],
  ["swap", "POST", X, { body: tx("mainnet", "Swap 1 ETH for USDC") }, 400, "unsupported"],
  ["'all' amount", "POST", X, { body: tx("mainnet", `Send all ETH to ${B}`) }, 400, "unsupported"],
  ["scheduled transfer", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${B} tomorrow`) }, 400, "unsupported"],
  ["token instead of ETH", "POST", X, { body: tx("mainnet", `Send 5 USDC to ${B}`) }, 400, "not_eth"],
  ["two recipients", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${B} and ${C}`) }, 400, "multiple"],
  [".eth name", "POST", X, { body: tx("mainnet", "Send 0.01 ETH to vitalik.eth") }, 400, "ens"],
  ["EIP-55 checksum mismatch", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${BAD_SUM}`) }, 400, "bad_checksum"],
  ["zero address", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${ZERO}`) }, 400, "zero_address"],
  ["sender = recipient", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${A}`) }, 400, "self_transfer"],
  ["instruction names the other network", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${B} on testnet`) }, 400, "network_mismatch"],
  ["empty instruction", "POST", X, { body: tx("mainnet", "") }, 400, "empty"],
  ["not a transfer sentence", "POST", X, { body: tx("mainnet", "hello there") }, 400, "unrecognized"],
  ["instruction over 200 characters", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${B} ` + "please ".repeat(25)) }, 400, "too_long"],
  ["fields: amount 0", "POST", X, { body: { network: "mainnet", from: A, to: B, amount: "0" } }, 400, "bad_amount"],
  ["fields: 19 decimals", "POST", X, { body: { network: "mainnet", from: A, to: B, amount: "0.0000000000000000001" } }, 400, "bad_amount"],
  ["fields: malformed recipient", "POST", X, { body: { network: "mainnet", from: A, to: "0x1234", amount: "0.01" } }, 400, "bad_address"],
  ["unknown network", "POST", X, { body: { network: "devnet", from: A, text: `Send 0.01 ETH to ${B}` } }, 400, "bad_network"],
  ["no wallet connected", "POST", X, { body: { network: "mainnet", from: "0x123", text: `Send 0.01 ETH to ${B}` } }, 400, "bad_sender"],
  ["instruction and fields together", "POST", X, { body: { network: "mainnet", from: A, text: "x", to: B, amount: "0.01" } }, 400, "bad_request"],
  ["unexpected field", "POST", X, { body: { network: "mainnet", from: A, text: `Send 0.01 ETH to ${B}`, gas: "1" } }, 400, "bad_request"],
  ["not JSON", "POST", X, { raw: "network=mainnet" }, 400, "bad_json"],
  ["wrong content type", "POST", X, { raw: "{}", headers: { "content-type": "text/plain" } }, 415, "bad_content_type"],
  // Same-site rule (docs: api.md "Who can call what")
  ["transfer preview from another website", "POST", X, { body: tx("mainnet", `Send 0.01 ETH to ${B}`), headers: { origin: "https://example.com", "sec-fetch-site": "cross-site" } }, 403, "cross_site"],
  ["research run from another website", "POST", "/api/runs", { body: {}, headers: { origin: "https://example.com", "sec-fetch-site": "cross-site" } }, 403, "cross_site"],
  ["AI wallet analysis from another website", "POST", "/api/chain/analyze", { body: {}, headers: { origin: "https://example.com", "sec-fetch-site": "cross-site" } }, 403, "cross_site"],
  // Read endpoints answer, without CORS headers
  ["health", "GET", "/api/health", { headers: { origin: "https://example.com" } }, 200, null],
  ["quota", "GET", "/api/runs/quota", { headers: { origin: "https://example.com" } }, 200, null],
  ["chain config", "GET", "/api/chain?config=1", { headers: { origin: "https://example.com" } }, 200, null],
];

const rows = [];
let chainCalls = 0;
for (const [name, method, path, opts, wantStatus, wantCode] of CASES) {
  if (path === X && chainCalls++) await sleep(PACE_MS);
  const r = await call(method, path, opts);
  const code = r.json?.error ?? null;
  const pass = r.status === wantStatus && code === wantCode && r.cors === null;
  rows.push({ name, method, path, wantStatus, wantCode, status: r.status, code, cors: r.cors, ms: r.ms, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${String(r.status).padEnd(3)} ${String(code ?? "-").padEnd(16)} ${String(r.ms).padStart(5)} ms  ${name}`);
}

// Optional: one successful preview, checking the fee rules the docs state (gas limit = estimate + 20 %, fee cap = 2 × gas
// price, no tip, valid 60 s). Addresses are never written to the results file.
let quote = null;
if (QUOTE_FROM && QUOTE_TO) {
  await sleep(PACE_MS);
  const r = await call("POST", X, { body: { network: "mainnet", from: QUOTE_FROM, to: QUOTE_TO, amount: "0.001" } });
  const q = r.json?.quote;
  if (q) {
    const est = BigInt(q.gasEstimate), limit = BigInt(q.gasLimit);
    const ttl = Date.parse(q.expiresAt) - Date.now();
    quote = {
      status: r.status, ms: r.ms, chainId: q.chainId, gasEstimate: q.gasEstimate, gasLimit: q.gasLimit,
      gasLimitIsEstimatePlus20pct: limit === (est * 12n + 9n) / 10n,
      maxPriorityFeePerGasWei: q.maxPriorityFeePerGasWei,
      feeCapIs2xGasPrice: BigInt(q.maxFeePerGasWei) === BigInt(Math.round(q.gasPriceGwei * 1e9)) * 2n,
      expiresInSeconds: Math.round(ttl / 1000),
    };
  } else quote = { status: r.status, ms: r.ms, error: r.json?.error ?? null };
  console.log("preview:", JSON.stringify(quote));
}

const passed = rows.filter((r) => r.pass).length;
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const summary = {
  cases: rows.length, passed, failed: rows.length - passed,
  latencyMs: { min: ms[0], median: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] },
  corsHeaders: rows.filter((r) => r.cors !== null).length,
};
console.log(`\n${passed}/${rows.length} passed · latency median ${summary.latencyMs.median} ms (min ${summary.latencyMs.min}, max ${summary.latencyMs.max}) · CORS headers ${summary.corsHeaders}`);
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), summary, rows, quote }, null, 2) + "\n");
console.log(`written ${OUT}`);
process.exitCode = passed === rows.length ? 0 : 1;
