// Account-level credit balances for the cost tracker: what the Apify and OpenRouter accounts behind this dashboard
// have used and have left — everything, not only the researches run here. Read-only, best-effort: a provider that
// does not answer just shows as unavailable.
import { round6 } from "./cost.js";

const num = v => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));

async function getJson(url, headers, timeoutMs = 8000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message || json?.error || `HTTP ${res.status}`);
    return json;
  } finally { clearTimeout(t); }
}

/** Apify: usage in the current monthly billing cycle against the account's monthly limit (GET /v2/users/me/limits). */
export async function apifyCredits(token) {
  if (!token) return { ok: false, error: "no Apify token" };
  try {
    const d = (await getJson("https://api.apify.com/v2/users/me/limits", { Authorization: `Bearer ${token}` }))?.data || {};
    const used = num(d.current?.monthlyUsageUsd), limit = num(d.limits?.maxMonthlyUsageUsd);
    return { ok: used != null, used_usd: used == null ? null : round6(used), limit_usd: limit, left_usd: used != null && limit != null ? round6(Math.max(0, limit - used)) : null,
      cycle_start: d.monthlyUsageCycle?.startAt || null, cycle_end: d.monthlyUsageCycle?.endAt || null };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 160) }; }
}

/** OpenRouter: credits bought vs used on the account (GET /api/v1/credits), plus this key's own usage/limit (GET /api/v1/key). */
export async function openrouterCredits(apiKey) {
  if (!apiKey) return { ok: false, error: "no OpenRouter key" };
  const auth = { Authorization: `Bearer ${apiKey}` };
  const [credits, key] = await Promise.allSettled([getJson("https://openrouter.ai/api/v1/credits", auth), getJson("https://openrouter.ai/api/v1/key", auth)]);
  const c = credits.status === "fulfilled" ? credits.value?.data || {} : {};
  const k = key.status === "fulfilled" ? key.value?.data || {} : {};
  const bought = num(c.total_credits), used = num(c.total_usage);
  const out = { ok: bought != null || num(k.usage) != null, bought_usd: bought, used_usd: used == null ? null : round6(used), left_usd: bought != null && used != null ? round6(bought - used) : null,
    key_used_usd: num(k.usage) == null ? null : round6(k.usage), key_limit_usd: num(k.limit), key_left_usd: num(k.limit_remaining) };
  if (!out.ok) out.error = String((credits.reason || key.reason)?.message || "unavailable").slice(0, 160);
  return out;
}

export async function accountCredits(keys) {
  const [apify, openrouter] = await Promise.all([apifyCredits(keys.apify), openrouterCredits(keys.openrouter)]);
  return { apify, openrouter, checked_at: new Date().toISOString() };
}
