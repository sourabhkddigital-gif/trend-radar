import { test } from "node:test";
import assert from "node:assert/strict";
import { apifyCredits, openrouterCredits } from "../lib/credits.js";

const stub = routes => { const real = globalThis.fetch; globalThis.fetch = async url => { const r = routes[new URL(url).pathname]; return { ok: !!r, status: r ? 200 : 401, json: async () => r || { error: { message: "No auth" } } }; }; return () => { globalThis.fetch = real; }; };

test("Apify: billing-cycle usage against the monthly limit", async () => {
  const undo = stub({ "/v2/users/me/limits": { data: { monthlyUsageCycle: { startAt: "2026-09-15T00:00:00Z", endAt: "2026-10-14T23:59:59Z" }, limits: { maxMonthlyUsageUsd: 29 }, current: { monthlyUsageUsd: 7.4213 } } } });
  try { const a = await apifyCredits("tok"); assert.equal(a.ok, true); assert.equal(a.used_usd, 7.4213); assert.equal(a.limit_usd, 29); assert.equal(a.left_usd, 21.5787); assert.ok(a.cycle_start); } finally { undo(); }
});

test("OpenRouter: credits bought vs used, and a failing provider is reported, not thrown", async () => {
  let undo = stub({ "/api/v1/credits": { data: { total_credits: 20, total_usage: 3.4172 } }, "/api/v1/key": { data: { usage: 1.2, limit: 10, limit_remaining: 8.8 } } });
  try { const o = await openrouterCredits("k"); assert.equal(o.ok, true); assert.equal(o.left_usd, 16.5828); assert.equal(o.key_limit_usd, 10); } finally { undo(); }
  undo = stub({});
  try { const o = await openrouterCredits("bad"); assert.equal(o.ok, false); assert.match(o.error, /No auth/); assert.equal((await apifyCredits(null)).ok, false); } finally { undo(); }
});
