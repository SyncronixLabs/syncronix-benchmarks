// Every block's base fee around one moment on Robinhood Chain, read from the official RPC.
//
//   node harness/fee-spike.mjs --block 119573026 [--network mainnet|testnet] [--before 30] [--after 180]
//                              [--out results/fee-spike.json]
//
// Used to look closely at a window that fee-headroom.mjs found (it samples one block every 10 s). Treats the base fee
// at --block as the preview's gas price and reports, for a fee cap of 2 × that price:
//   - the highest base fee and when it occurred,
//   - for how many blocks / seconds the base fee was above the cap (a transfer signed with that cap could not be
//     included during that time).
// Read-only, no key. Requires Node.js 18+. No dependencies.
import fs from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const NET = arg("network", "mainnet");
const RPC = { mainnet: "https://rpc.mainnet.chain.robinhood.com", testnet: "https://rpc.testnet.chain.robinhood.com" }[NET];
const START = Number(arg("block", "0"));
const BEFORE = Number(arg("before", "30"));
const AFTER = Number(arg("after", "180"));
const BATCH = Number(arg("batch", "25"));
const OUT = arg("out", `results/fee-spike-${NET}-${START}.json`);
if (!START) {
  console.error("usage: node harness/fee-spike.mjs --block <number> [--network mainnet|testnet] [--before s] [--after s]");
  process.exitCode = 2;
} else {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (n) => "0x" + n.toString(16);
  async function batch(ns) {
    const body = ns.map((n, id) => ({ jsonrpc: "2.0", id, method: "eth_getBlockByNumber", params: [hex(n), false] }));
    let out;
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      out = await r.json().catch(() => null);
      if (Array.isArray(out)) break;
      if (attempt >= 4) throw new Error(`RPC refused the batch: ${JSON.stringify(out).slice(0, 200)}`);
      await sleep(1500 * (attempt + 1));
    }
    return out.sort((a, b) => a.id - b.id).map((x) => {
      if (x.error) throw new Error(x.error.message);
      return { n: Number(x.result.number), t: Number(x.result.timestamp), fee: Number(BigInt(x.result.baseFeePerGas)) };
    });
  }
  // Block rate near the start, to turn seconds into block counts.
  const [a, b] = await batch([START - 5000, START]);
  const bps = 5000 / Math.max(1, b.t - a.t);
  const from = START - Math.round(BEFORE * bps), to = START + Math.round(AFTER * bps);
  const blocks = [];
  for (let n = from; n <= to; n += BATCH) {
    blocks.push(...(await batch(Array.from({ length: Math.min(BATCH, to - n + 1) }, (_, i) => n + i))));
    await sleep(250);
  }
  const start = blocks.find((x) => x.n === START);
  const cap = start.fee * 2;
  const peak = blocks.reduce((m, x) => (x.fee > m.fee ? x : m), blocks[0]);
  const after = blocks.filter((x) => x.n >= START);
  const over = after.filter((x) => x.fee > cap);
  // Longest continuous stretch above the cap.
  let run = 0, best = { blocks: 0, from: null, to: null };
  for (let i = 0; i < after.length; i++) {
    if (after[i].fee > cap) {
      run++;
      if (run > best.blocks) best = { blocks: run, from: after[i - run + 1], to: after[i] };
    } else run = 0;
  }
  const firstOver = over[0] || null;
  const summary = {
    network: NET, startBlock: START, startTime: new Date(start.t * 1000).toISOString(), blocksPerSecond: +bps.toFixed(2),
    startBaseFeeGwei: start.fee / 1e9, feeCapGwei: cap / 1e9,
    peak: { block: peak.n, secondsAfterStart: peak.t - start.t, baseFeeGwei: peak.fee / 1e9, ratio: +(peak.fee / start.fee).toFixed(3) },
    aboveCap: {
      blocks: over.length, firstSecondsAfterStart: firstOver ? firstOver.t - start.t : null,
      longestStretch: best.blocks ? { blocks: best.blocks, seconds: best.to.t - best.from.t + 1, fromSecond: best.from.t - start.t } : null,
    },
    blocksRead: blocks.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ...summary, ranAt: new Date().toISOString(), rpc: RPC, blocks: blocks.map((x) => [x.n, x.t, x.fee]) }) + "\n");
  console.log(`written ${OUT}`);
}
