// Job lifecycle: create (start actor runs) → advance (collect finished datasets, then run the brain) → complete.
import { apify } from "./apify.js";
import { plan, normalize, FIELDS, PLATFORMS } from "./sources.js";
import { scoreItems, buildClusters } from "./score.js";
import { buildPrompt, runBrain, BRAIN_BUDGET_MS } from "./brain.js";

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const STORE = process.env.KV_STORE_NAME || "trend-radar-jobs";
const MAX_RUN_MIN = 7;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * Which keys a request runs with. Visitors with their own Apify token (BYO) always pass.
 * Otherwise the server keys are used; the access code is enforced only for actions that spend
 * credits (`spend: true` — starting a research, re-running the analysis). Viewing results is open,
 * so shared /r/<id> links work for anyone.
 */
export function resolveKeys(headers, { spend = false } = {}) {
  const h = k => headers[k] || headers[k.toLowerCase()] || "";
  const byoApify = h("x-apify-token").trim();
  if (byoApify) return { apify: byoApify, openrouter: h("x-openrouter-key").trim() || null, model: h("x-openrouter-model").trim() || process.env.OPENROUTER_MODEL, source: "byo" };
  if (!process.env.APIFY_TOKEN) throw new HttpError(503, "This deployment has no Apify token configured. Open Settings and add your own Apify token.");
  if (spend && process.env.ACCESS_CODE && h("x-access-code").trim() !== process.env.ACCESS_CODE) throw new HttpError(401, "Access code required for this. Open Settings (⚙) and enter the access code once.");
  return { apify: process.env.APIFY_TOKEN, openrouter: process.env.OPENROUTER_API_KEY || null, model: process.env.OPENROUTER_MODEL, source: "server" };
}

async function store(keys) { return apify.storeId(keys.apify, STORE); }
export async function loadJob(keys, id) { const sid = await store(keys); return { sid, job: await apify.kvGet(keys.apify, sid, "job-" + id) }; }
async function saveJob(keys, sid, job) { job.updated_at = new Date().toISOString(); await apify.kvSet(keys.apify, sid, "job-" + job.id, job); }

async function updateIndex(keys, sid, job) {
  const idx = (await apify.kvGet(keys.apify, sid, "index")) || { jobs: [] };
  const entry = { id: job.id, mode: job.mode, topic: job.topic, region: job.region, windowH: job.windowH, created_at: job.created_at, status: job.status, n_items: job.items?.length || 0, n_clusters: job.clusters?.length || 0, top: job.clusters?.[0]?.name || "" };
  idx.jobs = [entry, ...idx.jobs.filter(j => j.id !== job.id)].slice(0, 80);
  await apify.kvSet(keys.apify, sid, "index", idx);
}
export async function listJobs(keys) { const sid = await store(keys); return ((await apify.kvGet(keys.apify, sid, "index")) || { jobs: [] }).jobs; }

export async function createJob(keys, { mode, topic, region, windowH, platforms }) {
  mode = mode === "trending" ? "trending" : "topic";
  topic = String(topic || "").trim().slice(0, 120);
  if (mode === "topic" && topic.length < 2) throw new HttpError(400, "Enter a topic to research (2–120 characters).");
  region = ["US", "IN", "GB", "Global"].includes(region) ? region : "US";
  windowH = [24, 48, 168].includes(Number(windowH)) ? Number(windowH) : 24;
  const runs = plan({ mode, topic, region, windowH, platforms });
  if (!runs.length) throw new HttpError(400, "Pick at least one platform.");

  const job = { id: newId(), mode, topic: mode === "trending" ? "What's trending now" : topic, region, windowH, platforms: runs.map(r => r.platform),
    created_at: new Date().toISOString(), status: "running", key_source: keys.source, sources: [], items: [], series: null,
    brain: { status: keys.openrouter ? "pending" : "skipped", model: keys.model || null }, summary: "", clusters: [], next_queries: [] };

  const started = await Promise.allSettled(runs.map(r => apify.startRun(keys.apify, r.actor, r.input, { timeout: MAX_RUN_MIN * 60 })));
  started.forEach((s, i) => {
    const r = runs[i];
    const src = { platform: r.platform, actor: r.actor, label: r.label, kind: r.kind || "items", started_at: new Date().toISOString() };
    if (s.status === "fulfilled") Object.assign(src, { runId: s.value.id, datasetId: s.value.datasetId, status: "running" });
    else Object.assign(src, { status: "failed", error: String(s.reason?.message || s.reason).slice(0, 200) });
    job.sources.push(src);
  });
  if (!job.sources.some(s => s.status === "running")) { job.status = "failed"; job.error = job.sources[0]?.error || "No source could start."; }

  const sid = await store(keys);
  await saveJob(keys, sid, job);
  await updateIndex(keys, sid, job);
  return job;
}

/** Collect any finished runs, run the brain when everything is in, persist. Idempotent enough for concurrent pollers. */
export async function advanceJob(keys, id, { retryBrain = false } = {}) {
  const { sid, job } = await loadJob(keys, id);
  if (!job) throw new HttpError(404, "Job not found.");
  if (job.status !== "running" && !retryBrain) return job;
  let changed = false;

  // 1. sources
  for (const src of job.sources) {
    if (src.status !== "running") continue;
    let run;
    try { run = await apify.getRun(keys.apify, src.runId); } catch (e) { continue; }
    const ageMin = (Date.now() - new Date(src.started_at)) / 60000;
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status) || ageMin > MAX_RUN_MIN + 1) {
      if (ageMin > MAX_RUN_MIN + 1 && run.status === "RUNNING") await apify.abortRun(keys.apify, src.runId);
      try {
        const rows = await apify.getItems(keys.apify, src.datasetId, { fields: FIELDS[src.actor], limit: 300 });
        const { items, series } = normalize({ platform: src.platform, actor: src.actor, kind: src.kind }, rows, { region: job.region, windowH: job.windowH });
        if (series) job.series = series;
        const seen = new Set(job.items.map(i => i.platform + "|" + i.url));
        for (const it of items) { const k = it.platform + "|" + it.url; if (seen.has(k)) continue; seen.add(k); it.source_label = src.label; job.items.push(it); }
        src.count = items.length + (series ? series.points.length : 0);
        src.status = run.status === "SUCCEEDED" || src.count ? (src.count ? "done" : "empty") : "failed";
        if (src.status === "failed") src.error = run.statusMessage || run.status;
      } catch (e) { src.status = "failed"; src.error = String(e.message).slice(0, 200); }
      src.finished_at = new Date().toISOString();
      changed = true;
    }
  }

  const allDone = job.sources.every(s => s.status !== "running");
  if (changed) scoreItems(job.items, { windowH: job.windowH });

  // 2. brain
  // A "running" brain older than the budget means the function that ran it was killed: pick it up again, at most twice.
  const brainStale = job.brain.status === "running" && Date.now() - new Date(job.brain.started_at) > BRAIN_BUDGET_MS + 30000;
  if (brainStale && (job.brain.attempts || 1) >= 3) { job.brain = { ...job.brain, status: "failed", error: "Analysis timed out three times. Try a faster model (⚙ Settings → Model) or press Retry analysis." }; changed = true; }
  else if (allDone && (job.brain.status === "pending" || (retryBrain && ["failed", "skipped", "done"].includes(job.brain.status)) || brainStale)) {
    if (!keys.openrouter) { job.brain.status = "skipped"; job.brain.error = "No OpenRouter key: results are shown without signals or angles."; }
    else if (job.items.length < 3) { job.brain.status = "skipped"; job.brain.error = "Too few results to analyse."; }
    else {
      job.brain = { status: "running", started_at: new Date().toISOString(), model: keys.model || null, attempts: (job.brain.attempts || 0) + 1 };
      await saveJob(keys, sid, job);
      try {
        const prompt = buildPrompt({ mode: job.mode, topic: job.topic, region: job.region, windowH: job.windowH, items: job.items, series: job.series });
        const out = await runBrain({ apiKey: keys.openrouter, model: keys.model, prompt });
        const off = new Set(out.offtopic || []);
        job.items.forEach(it => { it.offtopic = off.has(it.id); });
        job.clusters = buildClusters(job.items, out, { windowH: job.windowH });
        job.summary = out.summary || ""; job.next_queries = (out.next_queries || []).slice(0, 6);
        job.brain = { status: "done", model: out.model, finished_at: new Date().toISOString() };
      } catch (e) { job.brain = { ...job.brain, status: "failed", error: String(e.message).slice(0, 300) }; }
    }
    changed = true;
  }

  if (allDone && job.brain.status !== "running" && job.brain.status !== "pending") {
    job.status = job.items.length ? "complete" : "failed";
    if (job.status === "failed") job.error = "No results came back from any platform.";
    job.completed_at = job.completed_at || new Date().toISOString();
    job.stats = stats(job);
    changed = true;
  }
  if (changed) { await saveJob(keys, sid, job); await updateIndex(keys, sid, job); }
  return job;
}

function stats(job) {
  const cats = {}, plats = {};
  job.items.forEach(i => { if (i.offtopic) return; cats[i.category] = (cats[i.category] || 0) + 1; plats[i.platform] = (plats[i.platform] || 0) + 1; });
  return { items: job.items.filter(i => !i.offtopic).length, offtopic: job.items.filter(i => i.offtopic).length, clusters: job.clusters.length, cross_platform: job.clusters.filter(c => c.platforms.length >= 2).length, categories: cats, platforms: plats };
}

export { PLATFORMS };
