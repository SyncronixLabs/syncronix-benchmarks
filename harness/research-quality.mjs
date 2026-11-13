// Research-quality benchmark for a SYNCRONIX Research Agent endpoint.
//
//   node harness/research-quality.mjs [--base URL] [--tasks tasks/default.json] [--out results/run.json]
//
// Each task starts one research run (billed by the server you point it at) and records whether the agent read
// pages, cited them, repeated tool calls, and stayed within its cost ceiling.
// Env: SYNCRONIX_ADMIN_KEY (optional; needed for more than one run per day on the public service),
//      RUN_CEILING_USD (default 0.20).
// Requires Node.js 18+ (built-in fetch). No dependencies.
import fs from "node:fs";
import path from "node:path";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const BASE = arg("base", "http://localhost:3100").replace(/\/$/, "");
const TASKS = JSON.parse(fs.readFileSync(arg("tasks", "tasks/default.json"), "utf8"));
const OUT = arg("out", `results/run-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.json`);
const KEY = process.env.SYNCRONIX_ADMIN_KEY || "";
const CEILING = Number.parseFloat(process.env.RUN_CEILING_USD || "0.20");

let cookie = "";
const rows = [];

async function runTask(task) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(KEY ? { "x-console-key": KEY } : {}), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ task, fresh: true }),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { task, refused: `${res.status} ${j.error || ""}: ${j.message || ""}`.trim() };
  }
  const searches = [], fetches = [], notes = [];
  let done = null, failed = null, buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let k;
    while ((k = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, k);
      buf = buf.slice(k + 2);
      const ev = (block.match(/^event: (.+)$/m) || [])[1];
      const data = (block.match(/^data: (.+)$/m) || [])[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      if (ev === "search") searches.push(d.query);
      if (ev === "fetch_result") fetches.push({ url: d.url, ok: d.ok });
      if (ev === "note") notes.push(d.text);
      if (ev === "done") done = d;
      if (ev === "failed") failed = d;
    }
  }
  if (!done) return { task, failed: failed ? `${failed.code}: ${failed.message}` : "no result" };
  const g = done.sourceCheck?.grounding || {};
  const okFetches = fetches.filter((f) => f.ok).map((f) => f.url);
  return {
    task,
    seconds: Math.round((Date.now() - t0) / 1000),
    costUsd: done.costUsd,
    searches: done.searches,
    repeatedSearches: searches.length - new Set(searches.map((q) => q.toLowerCase().trim())).size,
    pagesRead: done.fetches,
    repeatedFetches: okFetches.length - new Set(okFetches).size,
    findings: g.findings ?? null,
    findingsCitingReadPage: g.readCited ?? null,
    unsourcedFindings: g.unsourced ?? null,
    singleSourceFindings: g.singleSource ?? null,
    citedPassages: g.citedPassages ?? null,
    sourcesTraced: `${done.sourceCheck?.verified}/${done.sourceCheck?.total}`,
    withinCeiling: done.costUsd <= CEILING,
    notes,
  };
}

for (const task of TASKS) {
  process.stdout.write(`… ${task.slice(0, 70)}\n`);
  rows.push(await runTask(task));
}

console.table(rows.map(({ notes, task, ...r }) => ({ task: task.slice(0, 40), ...r })));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), ceilingUsd: CEILING, rows }, null, 2));
console.log(`results → ${OUT}`);
