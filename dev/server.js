// Local dev server: serves public/ and routes /api/* to the Vercel-style handlers.
// With MOCK=1 it intercepts fetch() calls to Apify and OpenRouter and answers from test fixtures,
// so the whole flow can be exercised without network access or credits.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3000);
if (process.env.MOCK) await installMocks();

const handlers = {};
for (const name of ["research", "job", "jobs", "health", "history", "backfill"]) handlers[name] = (await import(pathToFileURL(path.join(ROOT, "api", name + ".js")).href)).default;

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/\W/g, "");
    const h = handlers[name]; if (!h) { res.writeHead(404); return res.end("no such api"); }
    let body = ""; for await (const c of req) body += c;
    const vreq = { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : {} };
    const vres = { status(c) { res.statusCode = c; return vres; }, setHeader(k, v) { res.setHeader(k, v); return vres; }, json(o) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); }, end(s) { res.end(s); } };
    try { await h(vreq, vres); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })); }
    return;
  }
  let file = url.pathname === "/" || url.pathname.startsWith("/r/") || url.pathname === "/history" ? "/index.html" : url.pathname;
  const fp = path.join(ROOT, "public", file);
  if (!fp.startsWith(path.join(ROOT, "public")) || !existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
  res.setHeader("Content-Type", fp.endsWith(".js") ? "text/javascript" : fp.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
  res.end(readFileSync(fp));
}).listen(PORT, () => console.log(`Trend Radar dev server on http://localhost:${PORT}${process.env.MOCK ? " (MOCK mode)" : ""}`));

async function installMocks() {
  const { fixtures } = await import(pathToFileURL(path.join(ROOT, "test", "fixtures.js")).href);
  const F = fixtures();
  const kv = new Map(); const runs = new Map(); let n = 0; const db = {};
  if (process.env.MOCK_DB) { process.env.SUPABASE_URL = "https://mock.supabase.co"; process.env.SUPABASE_SECRET_KEY = "sb_secret_mock"; }
  const realFetch = globalThis.fetch;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url); const m = (init.method || "GET").toUpperCase();
    if (u.hostname === "api.apify.com") {
      const p = u.pathname.replace(/^\/v2/, "");
      if (p === "/key-value-stores" && m === "POST") return json({ data: { id: "kv-mock" } });
      let mm;
      if ((mm = p.match(/^\/key-value-stores\/[^/]+\/records\/(.+)$/))) { const k = decodeURIComponent(mm[1]); if (m === "PUT") { kv.set(k, JSON.parse(init.body)); return new Response("", { status: 201 }); } return kv.has(k) ? json(kv.get(k)) : new Response("", { status: 404 }); }
      if ((mm = p.match(/^\/acts\/([^/]+)\/runs$/))) { const actor = decodeURIComponent(mm[1]).replace("~", "/"); const input = JSON.parse(init.body || "{}"); const id = "run" + (++n); const key = actor === "orbots/google-trends-scraper" && input.mode === "trending" ? actor + "#trending" : actor; runs.set(id, { actor, key, polls: 0, t0: Date.now(), fail: process.env.MOCK_FAIL === actor }); return json({ data: { id, defaultDatasetId: "ds-" + id, status: "RUNNING" } }); }
      if ((mm = p.match(/^\/actor-runs\/([^/]+)$/))) { const r = runs.get(mm[1]); r.dur ||= 1500 + Math.random() * 6000; const done = Date.now() - r.t0 > r.dur; const nRows = r.fail ? 0 : (F[r.key] || []).length; return json({ data: { id: mm[1], status: r.fail && done ? "FAILED" : done ? "SUCCEEDED" : "RUNNING", defaultDatasetId: "ds-" + mm[1], statusMessage: r.fail ? "mock failure" : "ok", startedAt: new Date(r.t0).toISOString(), finishedAt: done ? new Date(r.t0 + r.dur).toISOString() : null,
        // cost tracker fields, shaped like Apify's: a pay-per-event actor charging $0.004 per result (Google Trends: pay-per-result at $0.002)
        usageTotalUsd: done ? 0.0007 : 0, chargedEventCounts: done && !r.key.startsWith("orbots") ? { result: nRows } : {},
        pricingInfo: r.key.startsWith("orbots") ? { pricingModel: "PRICE_PER_DATASET_ITEM", pricePerUnitUsd: 0.002 } : { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { result: { eventTitle: "result", eventPriceUsd: 0.004 } } } } } }); }
      if ((mm = p.match(/^\/datasets\/ds-([^/]+)$/))) { const r = runs.get(mm[1]); return json({ data: { id: "ds-" + mm[1], itemCount: r.fail ? 0 : (F[r.key] || []).length } }); }
      if ((mm = p.match(/^\/datasets\/ds-([^/]+)\/items$/))) { const r = runs.get(mm[1]); return json(r.fail ? [] : (F[r.key] || [])); }
      if (p === "/users/me") return json({ data: { id: "u", username: "mock" } });
      return json({ error: { message: "mock: unknown " + p } }, 404);
    }
    if (u.hostname.endsWith("supabase.co")) {
      const t = u.pathname.replace(/^\/rest\/v1\//, ""); const tbl = (db[t] ||= []); const q = u.searchParams; const body = init.body ? JSON.parse(init.body) : null;
      const pk = t === "reports" ? r => r.id : r => r.report_id + "|" + (r.item_id ?? r.signal_id ?? r.platform);
      const eqId = [...q.entries()].find(([k, v]) => v.startsWith("eq."));
      if (m === "POST") { for (const r of [].concat(body)) { const i = tbl.findIndex(x => pk(x) === pk(r)); i >= 0 ? tbl[i] = r : tbl.push(r); } return new Response("", { status: 201 }); }
      if (m === "DELETE") { if (eqId) db[t] = tbl.filter(r => String(r[eqId[0]]) !== eqId[1].slice(3)); return new Response(null, { status: 204 }); }
      let rows = tbl.slice();
      if (eqId) rows = rows.filter(r => String(r[eqId[0]]) === eqId[1].slice(3));
      const or = q.get("or"); if (or) { const term = decodeURIComponent(or.match(/ilike\.\*(.*?)\*/)[1]).toLowerCase(); rows = rows.filter(r => ["topic", "brief", "top_signal", "summary"].some(c => String(r[c] || "").toLowerCase().includes(term))); }
      const gte = q.get("created_at")?.startsWith("gte.") ? q.get("created_at").slice(4) : null; if (gte) rows = rows.filter(r => r.created_at >= gte);
      if (q.get("order")?.startsWith("created_at.desc")) rows.sort((a, b) => b.created_at < a.created_at ? -1 : 1);
      const total = rows.length; const off = Number(q.get("offset") || 0), lim = Number(q.get("limit") || 1000); rows = rows.slice(off, off + lim);
      const sel = q.get("select"); if (sel && sel !== "*") rows = rows.map(r => Object.fromEntries(sel.split(",").map(c => [c, r[c]])));
      return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": `${off}-${off + rows.length - 1}/${total}` } });
    }
    if (u.hostname === "openrouter.ai") {
      const body = JSON.parse(init.body); const prompt = body.messages.at(-1).content;
      const ids = [...prompt.matchAll(/^([a-z]+-\d+) \|/gm)].map(x => x[1]);
      const byP = {}; ids.forEach(id => (byP[id.split("-")[0]] ||= []).push(id));
      const clusters = [];
      const grab = (name, cat, safety, pick) => { const sel = pick.filter(Boolean); if (sel.length) clusters.push({ id: "c" + (clusters.length + 1), name, category: cat, safety, why: `Mock: ${sel.length} results across ${new Set(sel.map(i => i.split("-")[0])).size} platforms.`, angles: ["Angle one for D2C clients", "Angle two for B2B clients"], formats: ["Reel", "Thread"], item_ids: sel }); };
      grab("Funding round in the space", "Business", "safe", [byP.news?.[1], byP.news?.[2], byP.youtube?.[0]]);
      grab("Agents and automation how-tos", "Tech & AI", "safe", [byP.x?.[0], byP.x?.[1], byP.tiktok?.[0], byP.instagram?.[0]]);
      grab("Traffic-camera mishap", "News & Weather", "caution", [byP.reddit?.[0]]);
      await new Promise(r => setTimeout(r, Number(process.env.MOCK_BRAIN_MS || 1200))); // MOCK_BRAIN_MS=15000 to see the long-analysis state
      return json({ id: "gen-mock-1", model: "mock/model", usage: { prompt_tokens: 4180, completion_tokens: 920, total_tokens: 5100, cost: 0.0193 }, choices: [{ message: { content: JSON.stringify({ summary: "Mock summary: the topic is having a moment, driven by a $350M raise and a wave of agent tutorials.", clusters, offtopic: [byP.tiktok?.[1]].filter(Boolean), next_queries: ["AI agents", "workflow automation", "EliseAI"] }) } }] });
    }
    return realFetch(input, init);
  };
  process.env.APIFY_TOKEN = process.env.APIFY_TOKEN || "mock-token";
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "mock-key";
}
