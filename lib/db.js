// Report archive: every research is saved to Supabase (Postgres) when it completes, through Supabase's REST API
// (PostgREST). No SDK or driver is needed — just the project URL and its secret key, which the Vercel ↔ Supabase
// integration injects as SUPABASE_URL and SUPABASE_SECRET_KEY. Everything here is best-effort: the dashboard keeps
// working if the database is missing or down; it just won't archive.
//
// Tables: reports (one row per research, full JSON in `data`), report_items (one row per result), report_signals.
// Schema: db/schema.sql — run once in the Supabase SQL editor.

const baseUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const secret = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const dbEnabled = () => !!(baseUrl() && secret());

const CHUNK = 200;
const num = v => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const int = v => (num(v) == null ? null : Math.round(num(v)));

async function rest(path, { method = "GET", body, prefer } = {}) {
  const key = secret();
  const res = await fetch(`${baseUrl()}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const e = new Error(`Supabase ${res.status}: ${json?.message || json?.hint || text.slice(0, 200) || res.statusText}`);
    e.status = res.status; e.code = json?.code; throw e;
  }
  const range = res.headers.get("content-range") || ""; // "0-49/312" when Prefer: count=exact
  const total = /\/(\d+)$/.test(range) ? Number(range.match(/\/(\d+)$/)[1]) : null;
  return { json, total };
}

/** Flatten a job (as stored in the Apify key-value store) into the three tables' rows. */
export function reportRows(job) {
  const items = job.items || [], clusters = job.clusters || [];
  const kept = items.filter(i => !i.offtopic).length;
  const report = {
    id: job.id, topic: job.topic || "", brief: job.brief || "", mode: job.mode || "topic", region: job.region || null, window_h: int(job.windowH),
    platforms: job.platforms || [], status: job.status || "running", created_at: job.created_at, completed_at: job.completed_at || null,
    duration_s: job.completed_at && job.created_at ? Math.max(1, Math.round((new Date(job.completed_at) - new Date(job.created_at)) / 1000)) : null,
    n_items: kept, n_offtopic: items.length - kept, n_signals: clusters.length, top_signal: clusters[0]?.name || null,
    summary: job.summary || null, next_queries: job.next_queries || [], brain_model: job.brain?.model || null, key_source: job.key_source || null,
    visitor: job.by || null, data: job, saved_at: new Date().toISOString(),
    // cost tracker: Apify credits (all platform runs) + OpenRouter credits (the AI step), in USD; null = not tracked for this report
    cost_usd: num(job.cost?.total_usd), cost_apify_usd: num(job.cost?.apify_usd), cost_brain_usd: num(job.cost?.brain_usd), cost: job.cost || null,
  };
  const sourceRows = (job.sources || []).filter(s => s.platform).map(s => ({
    report_id: job.id, platform: s.platform, actor: s.actor || null, run_id: s.runId || null, status: s.status || null, label: s.label || null,
    n_rows: int(s.count) ?? 0, duration_s: int(s.duration_s), cost_usd: num(s.cost?.usd), pricing_model: s.cost?.model || null, charged: s.cost?.detail || null, error: s.error ? String(s.error).slice(0, 300) : null,
  }));
  const itemRows = items.filter(i => i.id).map(i => ({
    report_id: job.id, item_id: i.id, platform: i.platform, title: String(i.topic || "").slice(0, 500), url: i.url || null, metric: num(i.metric), metric_label: i.metric_label || null,
    age_h: num(i.age_h), published: i.published || null, category: i.category || null, safety: i.safety || null, score: int(i.score), momentum: int(i.momentum),
    offtopic: !!i.offtopic, cluster_id: i.cluster || null, extra: i.extra ? String(i.extra).slice(0, 300) : null,
  }));
  const signalRows = clusters.map(c => ({
    report_id: job.id, signal_id: c.id, name: c.name, category: c.category || null, safety: c.safety || null, score: int(c.score), momentum: int(c.momentum),
    platforms: c.platforms || [], n_items: int(c.n_items) || 0, why: c.why || null, angles: c.angles || [], formats: c.formats || [],
  }));
  return { report, itemRows, signalRows, sourceRows };
}

/** Upsert the report and replace its items/signals. Returns the ISO time it was saved. */
export async function saveReport(job) {
  if (!dbEnabled() || !job?.id) return null;
  const { report, itemRows, signalRows, sourceRows } = reportRows(job);
  await rest("reports", { method: "POST", body: report, prefer: "resolution=merge-duplicates,return=minimal" });
  const id = encodeURIComponent(job.id);
  await rest(`report_items?report_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  for (let i = 0; i < itemRows.length; i += CHUNK) await rest("report_items", { method: "POST", body: itemRows.slice(i, i + CHUNK), prefer: "return=minimal" });
  await rest(`report_signals?report_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  if (signalRows.length) await rest("report_signals", { method: "POST", body: signalRows, prefer: "return=minimal" });
  await rest(`report_sources?report_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  if (sourceRows.length) await rest("report_sources", { method: "POST", body: sourceRows, prefer: "return=minimal" });
  return report.saved_at;
}

/** Like saveReport but never throws — the research must not fail because the archive is unreachable. */
export async function trySaveReport(job) {
  try { return await saveReport(job); }
  catch (e) { console.error("[db] archive failed for", job?.id, "-", e.message); return null; }
}

/** The full report JSON for one id (fallback when the Apify store no longer has it). */
export async function getReport(id) {
  if (!dbEnabled()) return null;
  const { json } = await rest(`reports?id=eq.${encodeURIComponent(id)}&select=data&limit=1`);
  return json?.[0]?.data || null;
}

const LIST_COLS = "id,topic,brief,mode,region,window_h,platforms,status,created_at,completed_at,duration_s,n_items,n_offtopic,n_signals,top_signal,summary,brain_model,cost_usd,cost_apify_usd,cost_brain_usd";
const clean = s => String(s || "").replace(/[,()"'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); // PostgREST filter syntax uses , ( ) and quotes

/** Search the archive. q matches keyword, focus, top signal and summary; from/to are ISO dates. */
export async function listReports({ q = "", from = "", to = "", region = "", limit = 50, offset = 0 } = {}) {
  if (!dbEnabled()) return { reports: [], total: 0 };
  const p = [`select=${LIST_COLS}`, "order=created_at.desc", `limit=${Math.min(1000, Math.max(1, Number(limit) || 50))}`, `offset=${Math.max(0, Number(offset) || 0)}`];
  const term = clean(q);
  if (term) p.push("or=(" + ["topic", "brief", "top_signal", "summary"].map(c => `${c}.ilike.*${encodeURIComponent(term)}*`).join(",") + ")");
  if (from && !isNaN(new Date(from))) p.push(`created_at=gte.${encodeURIComponent(new Date(from).toISOString())}`);
  if (to && !isNaN(new Date(to))) { const d = new Date(to); if (/^\d{4}-\d{2}-\d{2}$/.test(to)) d.setUTCHours(23, 59, 59, 999); p.push(`created_at=lte.${encodeURIComponent(d.toISOString())}`); }
  if (region) p.push(`region=eq.${encodeURIComponent(region)}`);
  const { json, total } = await rest(`reports?${p.join("&")}`, { prefer: "count=exact" });
  return { reports: json || [], total: total ?? (json || []).length };
}

/** Headline numbers for the history page, including the cost tracker's totals. */
export async function archiveStats() {
  if (!dbEnabled()) return null;
  const { json, total } = await rest("reports?select=topic,created_at,cost_usd,cost_apify_usd,cost_brain_usd,cost&order=created_at.asc&limit=2000", { prefer: "count=exact" });
  const rows = json || [];
  const r6 = n => Math.round(n * 1e6) / 1e6;
  const spend = { total_usd: 0, apify_usd: 0, brain_usd: 0, tracked: 0, untracked: 0, brain_untracked: 0, by_platform: {} };
  const cutoff = Date.now() - 92 * 86400000, recent = [];
  for (const r of rows) {
    if (r.cost_usd == null) { spend.untracked++; continue; }
    spend.tracked++; spend.total_usd += Number(r.cost_usd) || 0; spend.apify_usd += Number(r.cost_apify_usd) || 0;
    if (r.cost_brain_usd != null) spend.brain_usd += Number(r.cost_brain_usd) || 0;
    else if (r.cost?.brain_tracked === false && !r.cost?.brain_pending) spend.brain_untracked++; // the AI ran but its cost was never recorded (reports older than the tracker)
    for (const [p, v] of Object.entries(r.cost?.by_platform || {})) spend.by_platform[p] = r6((spend.by_platform[p] || 0) + (Number(v) || 0));
    if (new Date(r.created_at) >= cutoff) recent.push([r.created_at, r6(Number(r.cost_usd) || 0)]); // the page turns these into today / this month / per-day in the viewer's own timezone
  }
  spend.total_usd = r6(spend.total_usd); spend.apify_usd = r6(spend.apify_usd); spend.brain_usd = r6(spend.brain_usd);
  return { reports: total ?? rows.length, keywords: new Set(rows.map(r => (r.topic || "").toLowerCase())).size, since: rows[0]?.created_at || null, spend, recent };
}
