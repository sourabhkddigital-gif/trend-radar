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
for (const name of ["research", "job", "jobs", "health"]) handlers[name] = (await import(pathToFileURL(path.join(ROOT, "api", name + ".js")).href)).default;

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
  let file = url.pathname === "/" || url.pathname.startsWith("/r/") ? "/index.html" : url.pathname;
  const fp = path.join(ROOT, "public", file);
  if (!fp.startsWith(path.join(ROOT, "public")) || !existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
  res.setHeader("Content-Type", fp.endsWith(".js") ? "text/javascript" : fp.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
  res.end(readFileSync(fp));
}).listen(PORT, () => console.log(`Trend Radar dev server on http://localhost:${PORT}${process.env.MOCK ? " (MOCK mode)" : ""}`));

async function installMocks() {
  const { fixtures } = await import(pathToFileURL(path.join(ROOT, "test", "fixtures.js")).href);
  const F = fixtures();
  const kv = new Map(); const runs = new Map(); let n = 0;
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
      if ((mm = p.match(/^\/actor-runs\/([^/]+)$/))) { const r = runs.get(mm[1]); r.dur ||= 1500 + Math.random() * 6000; const done = Date.now() - r.t0 > r.dur; return json({ data: { id: mm[1], status: r.fail && done ? "FAILED" : done ? "SUCCEEDED" : "RUNNING", defaultDatasetId: "ds-" + mm[1], statusMessage: r.fail ? "mock failure" : "ok", startedAt: new Date(r.t0).toISOString(), finishedAt: done ? new Date(r.t0 + r.dur).toISOString() : null } }); }
      if ((mm = p.match(/^\/datasets\/ds-([^/]+)\/items$/))) { const r = runs.get(mm[1]); return json(r.fail ? [] : (F[r.key] || [])); }
      if (p === "/users/me") return json({ data: { id: "u", username: "mock" } });
      return json({ error: { message: "mock: unknown " + p } }, 404);
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
      return json({ model: "mock/model", choices: [{ message: { content: JSON.stringify({ summary: "Mock summary: the topic is having a moment, driven by a $350M raise and a wave of agent tutorials.", clusters, offtopic: [byP.tiktok?.[1]].filter(Boolean), next_queries: ["AI agents", "workflow automation", "EliseAI"] }) } }] });
    }
    return realFetch(input, init);
  };
  process.env.APIFY_TOKEN = process.env.APIFY_TOKEN || "mock-token";
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "mock-key";
}
