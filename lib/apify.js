// Thin Apify REST client. Zero dependencies (Node 18+ fetch).
const API = "https://api.apify.com/v2";

export class ApifyError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function call(token, method, path, body, { timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const msg = json?.error?.message || text.slice(0, 200) || res.statusText;
      throw new ApifyError(`Apify ${res.status}: ${msg}`, res.status, json);
    }
    return json;
  } finally { clearTimeout(t); }
}

export const apify = {
  /** Verify a token; returns {id, username} */
  async me(token) { const r = await call(token, "GET", "/users/me"); return { id: r.data.id, username: r.data.username }; },

  /** Start an actor run without waiting. Returns {id, datasetId, status}. */
  async startRun(token, actor, input, options = {}) {
    const q = new URLSearchParams();
    if (options.memory) q.set("memory", String(options.memory));
    if (options.timeout) q.set("timeout", String(options.timeout));
    const r = await call(token, "POST", `/acts/${actor.replace("/", "~")}/runs?${q}`, input);
    return { id: r.data.id, datasetId: r.data.defaultDatasetId, status: r.data.status };
  },

  async getRun(token, runId) {
    const r = await call(token, "GET", `/actor-runs/${runId}`);
    const d = r.data;
    // The pricing fields are what the cost tracker reads: platform usage in USD plus, for pay-per-event / pay-per-result actors, what was charged.
    return { id: d.id, status: d.status, datasetId: d.defaultDatasetId, statusMessage: d.statusMessage, startedAt: d.startedAt, finishedAt: d.finishedAt,
      usageTotalUsd: d.usageTotalUsd ?? null, pricingInfo: d.pricingInfo || null, chargedEventCounts: d.chargedEventCounts || null, pricingTier: d.pricingTier || d.options?.pricingTier || null };
  },

  /** Dataset metadata — itemCount is what pay-per-result actors charge for. */
  async getDataset(token, datasetId) {
    const r = await call(token, "GET", `/datasets/${datasetId}`);
    return { id: r.data.id, itemCount: r.data.itemCount ?? 0 };
  },

  async abortRun(token, runId) { try { await call(token, "POST", `/actor-runs/${runId}/abort`); } catch {} },

  async getItems(token, datasetId, { fields, limit = 200, offset = 0 } = {}) {
    const q = new URLSearchParams({ clean: "true", format: "json", limit: String(limit), offset: String(offset) });
    if (fields?.length) q.set("fields", fields.join(","));
    return (await call(token, "GET", `/datasets/${datasetId}/items?${q}`)) || [];
  },

  // ---- key-value store used as the job database (one named store per Apify account)
  async storeId(token, name = "trend-radar-jobs") {
    const r = await call(token, "POST", `/key-value-stores?name=${encodeURIComponent(name)}`);
    return r.data.id;
  },
  async kvGet(token, storeId, key) {
    try { return await call(token, "GET", `/key-value-stores/${storeId}/records/${encodeURIComponent(key)}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  },
  async kvSet(token, storeId, key, value) {
    await call(token, "PUT", `/key-value-stores/${storeId}/records/${encodeURIComponent(key)}`, value);
  },
  async kvKeys(token, storeId, { prefix = "", limit = 50 } = {}) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (prefix) q.set("prefix", prefix);
    const r = await call(token, "GET", `/key-value-stores/${storeId}/keys?${q}`);
    return (r.data.items || []).map(i => i.key);
  },
};
