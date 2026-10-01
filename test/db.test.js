import { test } from "node:test";
import assert from "node:assert/strict";
import { reportRows, saveReport, listReports, dbEnabled } from "../lib/db.js";

const job = { id: "abc123", topic: "running shoes", brief: "marathon shoes", mode: "topic", region: "US", windowH: 24, platforms: ["news", "reddit"], status: "complete",
  sources: [{ platform: "news", actor: "a/news", runId: "r1", status: "done", label: "Google News · US", count: 25, duration_s: 9, cost: { usd: 0.1, model: "PAY_PER_EVENT", detail: { result: { count: 25, price_usd: 0.004, usd: 0.1 } } } }, { platform: "reddit", actor: "a/reddit", runId: "r2", status: "failed", error: "boom" }],
  cost: { total_usd: 0.12, apify_usd: 0.1, brain_usd: 0.02, by_platform: { news: 0.1 }, brain_tracked: true },
  created_at: "2026-10-01T05:00:00.000Z", completed_at: "2026-10-01T05:01:10.000Z", by: "deadbeef", key_source: "server", summary: "Nike launched…", next_queries: ["Nike Apex"], brain: { model: "anthropic/claude-sonnet-4.5" },
  items: [{ id: "news-1", platform: "news", topic: "Nike debuts Apex", url: "https://x.y/z", metric: null, age_h: 3.2, category: "Sports", safety: "safe", score: 71, momentum: 18, cluster: "c1" }, { id: "reddit-1", platform: "reddit", topic: "Sneaker fashion", url: "https://r/x", metric: 1200, metric_label: "upvotes", offtopic: true }],
  clusters: [{ id: "c1", name: "Nike Apex launch", category: "Sports", safety: "safe", score: 75, momentum: 18, platforms: ["news"], n_items: 1, why: "9 articles", angles: ["a"], formats: ["Reel"] }] };

test("reportRows flattens a job into report, items and signals", () => {
  const { report, itemRows, signalRows } = reportRows(job);
  assert.equal(report.id, "abc123"); assert.equal(report.n_items, 1); assert.equal(report.n_offtopic, 1); assert.equal(report.n_signals, 1);
  assert.equal(report.duration_s, 70); assert.equal(report.top_signal, "Nike Apex launch"); assert.deepEqual(report.data, job);
  assert.equal(itemRows.length, 2); assert.equal(itemRows[1].offtopic, true); assert.equal(itemRows[0].cluster_id, "c1");
  assert.equal(signalRows[0].signal_id, "c1"); assert.deepEqual(signalRows[0].angles, ["a"]);
  assert.equal(report.cost_usd, 0.12); assert.equal(report.cost_apify_usd, 0.1); assert.equal(report.cost_brain_usd, 0.02); assert.deepEqual(report.cost.by_platform, { news: 0.1 });
  const { sourceRows } = reportRows(job);
  assert.equal(sourceRows.length, 2); assert.equal(sourceRows[0].cost_usd, 0.1); assert.equal(sourceRows[0].pricing_model, "PAY_PER_EVENT"); assert.equal(sourceRows[0].charged.result.count, 25); assert.equal(sourceRows[1].cost_usd, null); assert.equal(sourceRows[1].error, "boom");
});

test("saveReport and listReports talk PostgREST (upsert, replace children, filters, count)", async () => {
  process.env.SUPABASE_URL = "https://proj.supabase.co"; process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  assert.ok(dbEnabled());
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init.method || "GET", prefer: init.headers.Prefer, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    const headers = new Map([["content-range", "0-0/42"]]);
    return { ok: true, status: 200, statusText: "OK", headers: { get: k => headers.get(k) }, text: async () => (init.method || "GET") === "GET" ? JSON.stringify([{ id: "abc123", topic: "running shoes" }]) : "" }; };
  try {
    const at = await saveReport(job);
    assert.ok(at);
    assert.equal(calls[0].url, "https://proj.supabase.co/rest/v1/reports"); assert.equal(calls[0].method, "POST"); assert.match(calls[0].prefer, /merge-duplicates/); assert.equal(calls[0].auth, "Bearer sb_secret_test");
    assert.equal(calls[1].method, "DELETE"); assert.match(calls[1].url, /report_items\?report_id=eq\.abc123/);
    assert.equal(calls[2].method, "POST"); assert.equal(calls[2].body.length, 2);
    assert.equal(calls[3].method, "DELETE"); assert.match(calls[3].url, /report_signals/);
    assert.equal(calls[4].method, "POST"); assert.equal(calls[4].body[0].name, "Nike Apex launch");
    assert.equal(calls[5].method, "DELETE"); assert.match(calls[5].url, /report_sources\?report_id=eq\.abc123/);
    assert.equal(calls[6].method, "POST"); assert.equal(calls[6].body.length, 2); assert.equal(calls[6].body[0].platform, "news");
    const { reports, total } = await listReports({ q: "nike (apex), 'x'", from: "2026-10-01", to: "2026-10-01", limit: 10 });
    assert.equal(total, 42); assert.equal(reports[0].topic, "running shoes");
    const u = calls.at(-1).url; assert.match(u, /or=\(topic\.ilike\.\*nike%20apex%20x\*/); assert.match(u, /created_at=gte\./); assert.match(u, /created_at=lte\.2026-10-01T23%3A59%3A59/); assert.match(u, /limit=10/); assert.equal(calls.at(-1).prefer, "count=exact");
  } finally { globalThis.fetch = realFetch; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; }
});

test("without credentials the archive is a no-op", async () => {
  assert.equal(dbEnabled(), false);
  assert.equal(await saveReport(job), null);
  assert.deepEqual(await listReports({}), { reports: [], total: 0 });
});
