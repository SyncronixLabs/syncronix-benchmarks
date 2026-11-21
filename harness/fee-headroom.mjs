// Fee headroom on Robinhood Chain: does a 60-second transfer preview stay valid?
//
//   node harness/fee-headroom.mjs [--network mainnet|testnet] [--hours 24] [--samples 288] [--window 60]
//                                 [--live-minutes 20] [--interval 10] [--out results/fee-headroom.json]
//
// SYNCRONIX Execution v1 previews a transfer with gas limit = estimate + 20 %, fee cap = 2 × eth_gasPrice and no
// priority tip, valid for 60 s. This harness measures, from the official RPC only, how far the base fee and the gas
// estimate actually move inside such a window:
//   1. History: `--samples` windows spread over the last `--hours`. Each window reads the block at its start and one
//      block every 10 s up to `--window` seconds later (block headers, one batched request per window).
//   2. Live: for `--live-minutes`, every `--interval` seconds it records eth_gasPrice, the base fee of every block
//      (eth_feeHistory), eth_estimateGas for a plain transfer, and the L1 data component reported by the chain's
//      NodeInterface (Robinhood Chain is built on Arbitrum).
// Read-only. No SYNCRONIX endpoint, no wallet, no key. The transfer used for estimates is between two placeholder
// addresses (value 0), so no real account is involved. Requires Node.js 18+. No dependencies.
import fs from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const NET = arg("network", "mainnet");
const RPC = { mainnet: "https://rpc.mainnet.chain.robinhood.com", testnet: "https://rpc.testnet.chain.robinhood.com" }[NET];
const CHAIN_ID = { mainnet: 4663, testnet: 46630 }[NET];
const HOURS = Number(arg("hours", "24"));
const SAMPLES = Number(arg("samples", "288"));
const WINDOW_S = Number(arg("window", "60"));
const LIVE_MIN = Number(arg("live-minutes", "20"));
const INTERVAL_S = Number(arg("interval", "10"));
const OUT = arg("out", `results/fee-headroom-${NET}-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => "0x" + BigInt(n).toString(16);

let rpcCalls = 0;
async function rpc(calls) {
  // calls: [[method, params], …] sent as one JSON-RPC batch
  const body = calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }));
  for (let attempt = 0; ; attempt++) {
    try {
      rpcCalls += calls.length;
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const out = await r.json();
      const byId = new Map(out.map((x) => [x.id, x]));
      return calls.map((_, i) => {
        const x = byId.get(i);
        if (!x || x.error) throw new Error(x?.error?.message || "no result");
        return x.result;
      });
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
}
const one = async (method, params) => (await rpc([[method, params]]))[0];

// Percentile over a sorted array.
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
function dist(values) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, min: s[0], p50: pct(s, 50), p90: pct(s, 90), p99: pct(s, 99), max: s[s.length - 1] };
}
const share = (values, f) => +(values.filter(f).length / values.length).toFixed(4);

const chainId = Number(await one("eth_chainId", []));
if (chainId !== CHAIN_ID) throw new Error(`RPC reports chain ${chainId}, expected ${CHAIN_ID}`);

// ---------- 1. History ----------
const head = await one("eth_getBlockByNumber", ["latest", false]);
const headN = Number(head.number), headT = Number(head.timestamp);
const probeN = Math.max(1, headN - 1_000_000);
const probe = await one("eth_getBlockByNumber", [hex(probeN), false]);
const blocksPerSecond = (headN - probeN) / (headT - Number(probe.timestamp));
const step = Math.max(1, Math.round(blocksPerSecond * 10)); // one block every ~10 s inside a window
const span = Math.round(blocksPerSecond * HOURS * 3600);
console.log(`${NET} (chain ${chainId}): head ${headN}, ${blocksPerSecond.toFixed(2)} blocks/s; ${SAMPLES} windows of ${WINDOW_S} s over ${HOURS} h`);

const windows = [];
for (let i = 0; i < SAMPLES; i++) {
  const start = headN - span + Math.floor((i * span) / SAMPLES);
  const ns = [];
  for (let n = start; n <= start + Math.round(blocksPerSecond * WINDOW_S); n += step) ns.push(n);
  const blocks = await rpc(ns.map((n) => ["eth_getBlockByNumber", [hex(n), false]]));
  const fees = blocks.map((b) => Number(BigInt(b.baseFeePerGas)));
  const t0 = Number(blocks[0].timestamp), t1 = Number(blocks[blocks.length - 1].timestamp);
  windows.push({ block: start, time: new Date(t0 * 1000).toISOString(), seconds: t1 - t0, startFee: fees[0], maxFee: Math.max(...fees), points: fees.length });
  if (i % 48 === 47) console.log(`  ${i + 1}/${SAMPLES} windows`);
  await sleep(150);
}
const hRatio = windows.map((w) => w.maxFee / w.startFee);
const history = {
  blocksPerSecond: +blocksPerSecond.toFixed(3),
  from: windows[0].time, to: windows[windows.length - 1].time,
  baseFeeGwei: dist(windows.map((w) => w.startFee / 1e9)),
  maxOverStartInWindow: dist(hRatio),
  shareAbove: { "1.00": share(hRatio, (r) => r > 1), "1.10": share(hRatio, (r) => r > 1.1), "1.50": share(hRatio, (r) => r > 1.5), "2.00": share(hRatio, (r) => r > 2) },
  windows,
};
console.log(`history: base fee ${history.baseFeeGwei.min}–${history.baseFeeGwei.max} gwei; max/start within ${WINDOW_S} s: p50 ${history.maxOverStartInWindow.p50.toFixed(4)}, max ${history.maxOverStartInWindow.max.toFixed(4)}; above 2×: ${history.shareAbove["2.00"]}`);

// ---------- 2. Live ----------
const P1 = "0x1111111111111111111111111111111111111111";
const P2 = "0x2222222222222222222222222222222222222222";
// NodeInterface.gasEstimateL1Component(address to, bool contractCreation, bytes data) at 0x…C8
const l1Data = "0x77d488a2" + P2.slice(2).padStart(64, "0") + "0".repeat(64) + (96).toString(16).padStart(64, "0") + "0".repeat(64);
const fees = new Map(); // block number -> base fee (wei)
const polls = [];
const liveEnd = Date.now() + LIVE_MIN * 60_000;
console.log(`live: ${LIVE_MIN} min, every ${INTERVAL_S} s`);
while (Date.now() < liveEnd) {
  const t = Date.now();
  try {
    const [bn, gasPrice, est, l1, hist] = await rpc([
      ["eth_blockNumber", []],
      ["eth_gasPrice", []],
      ["eth_estimateGas", [{ from: P1, to: P2, value: "0x0" }, "latest"]],
      ["eth_call", [{ to: "0x00000000000000000000000000000000000000C8", data: l1Data }, "latest"]],
      ["eth_feeHistory", [hex(Math.ceil(blocksPerSecond * INTERVAL_S * 1.5) + 16), "latest", []]],
    ]);
    const oldest = Number(hist.oldestBlock);
    hist.baseFeePerGas.slice(0, -1).forEach((f, i) => fees.set(oldest + i, Number(BigInt(f))));
    const words = l1.slice(2).match(/.{64}/g) || [];
    polls.push({
      at: new Date(t).toISOString(), block: Number(bn), gasPriceWei: Number(BigInt(gasPrice)),
      estimateGas: Number(BigInt(est)), l1GasComponent: Number(BigInt("0x" + (words[0] || "0"))),
      l1BaseFeeEstimateWei: Number(BigInt("0x" + (words[2] || "0"))),
    });
  } catch (e) {
    polls.push({ at: new Date(t).toISOString(), error: String(e.message).slice(0, 120) });
  }
  await sleep(Math.max(0, INTERVAL_S * 1000 - (Date.now() - t)));
}
const ok = polls.filter((p) => !p.error);
const ns = [...fees.keys()].sort((a, b) => a - b);
const contiguous = ns.length ? ns[ns.length - 1] - ns[0] + 1 : 0;
// Every 60 s window over the recorded blocks: max base fee in the window / base fee at its start.
const w = Math.round(blocksPerSecond * WINDOW_S);
const lRatio = [];
for (let i = 0; i + w < ns.length; i += Math.max(1, Math.round(blocksPerSecond))) {
  if (ns[i + w] - ns[i] !== w) continue; // skip windows with gaps
  let m = 0;
  for (let j = i; j <= i + w; j++) m = Math.max(m, fees.get(ns[j]));
  lRatio.push(m / fees.get(ns[i]));
}
// eth_gasPrice compared with the base fee of the block it was read at (what the preview's fee cap is based on).
const priceVsBase = ok.filter((p) => fees.has(p.block)).map((p) => p.gasPriceWei / fees.get(p.block));
const live = {
  polls: polls.length, errors: polls.length - ok.length, blocksRecorded: ns.length, blocksSpanned: contiguous,
  baseFeeGwei: ns.length ? dist(ns.map((n) => fees.get(n) / 1e9)) : null,
  maxOverStartInWindow: lRatio.length ? dist(lRatio) : null,
  windowsChecked: lRatio.length,
  shareAbove: lRatio.length ? { "1.00": share(lRatio, (r) => r > 1), "1.10": share(lRatio, (r) => r > 1.1), "1.50": share(lRatio, (r) => r > 1.5), "2.00": share(lRatio, (r) => r > 2) } : null,
  gasPriceOverBaseFee: priceVsBase.length ? dist(priceVsBase) : null,
  estimateGas: ok.length ? dist(ok.map((p) => p.estimateGas)) : null,
  l1GasComponent: ok.length ? dist(ok.map((p) => p.l1GasComponent)) : null,
  l1BaseFeeEstimateWei: ok.length ? dist(ok.map((p) => p.l1BaseFeeEstimateWei)) : null,
  pollsDetail: polls,
};
console.log(`live: ${ns.length} blocks, ${lRatio.length} windows; max/start p50 ${live.maxOverStartInWindow?.p50?.toFixed(4)}, max ${live.maxOverStartInWindow?.max?.toFixed(4)}; gasPrice/baseFee ${live.gasPriceOverBaseFee?.min?.toFixed(4)}–${live.gasPriceOverBaseFee?.max?.toFixed(4)}; estimateGas ${live.estimateGas?.min}–${live.estimateGas?.max}; L1 component ${live.l1GasComponent?.min}–${live.l1GasComponent?.max}`);

const result = {
  network: NET, chainId, rpc: RPC, ranAt: new Date().toISOString(), rpcCalls,
  previewRules: { gasLimit: "estimate × 1.2", feeCap: "2 × eth_gasPrice", priorityTip: 0, validSeconds: WINDOW_S },
  history, live,
};
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");
console.log(`written ${OUT} (${rpcCalls} RPC calls)`);
