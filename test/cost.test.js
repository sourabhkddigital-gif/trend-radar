import { test } from "node:test";
import assert from "node:assert/strict";
import { runCost, brainCost, jobCost } from "../lib/cost.js";

test("pay-per-event run: charged events × price, platform usage ignored when smaller", () => {
  const run = { usageTotalUsd: 0.0011, chargedEventCounts: { result: 25 }, pricingInfo: { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { result: { eventTitle: "result", eventPriceUsd: 0.004 } } } } };
  const c = runCost(run);
  assert.equal(c.usd, 0.1); assert.equal(c.model, "PAY_PER_EVENT"); assert.equal(c.charged_usd, 0.1); assert.equal(c.usage_usd, 0.0011);
  assert.deepEqual(c.detail.result, { count: 25, price_usd: 0.004, usd: 0.1 });
});

test("pay-per-event run with tiered prices and no flat eventPriceUsd", () => {
  const run = { usageTotalUsd: 0, chargedEventCounts: { tweet: 32 }, pricingTier: "BRONZE",
    pricingInfo: { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { tweet: { eventTieredPricingUsd: { FREE: { tieredEventPriceUsd: 0.0005 }, BRONZE: { tieredEventPriceUsd: 0.0004 } } } } } } };
  assert.equal(runCost(run).usd, 0.0128);
});

test("usageTotalUsd that already includes the charges wins", () => {
  const run = { usageTotalUsd: 0.1234, chargedEventCounts: { result: 25 }, pricingInfo: { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { result: { eventPriceUsd: 0.004 } } } } };
  assert.equal(runCost(run).usd, 0.1234);
});

test("pay-per-result run uses the dataset item count; free actors use platform usage", () => {
  assert.equal(runCost({ usageTotalUsd: 0.0003, pricingInfo: { pricingModel: "PRICE_PER_DATASET_ITEM", pricePerUnitUsd: 0.002 } }, { itemCount: 180 }).usd, 0.36);
  assert.equal(runCost({ usageTotalUsd: 0.0421, pricingInfo: { pricingModel: "FREE" } }).usd, 0.0421);
  assert.equal(runCost({}).usd, 0);
});

test("brainCost reads OpenRouter usage", () => {
  assert.deepEqual(brainCost({ id: "gen-1", usage: { prompt_tokens: 4000, completion_tokens: 900, cost: 0.0187 } }), { usd: 0.0187, prompt_tokens: 4000, completion_tokens: 900, gen_id: "gen-1" });
  assert.equal(brainCost({ usage: { prompt_tokens: 1 } }).usd, null);
});

test("jobCost rolls sources and brain up, and knows what is untracked", () => {
  const job = { status: "complete", brain: { status: "done", cost_usd: 0.02 }, sources: [
    { platform: "news", runId: "a", status: "done", cost: { usd: 0.1 } }, { platform: "x", runId: "b", status: "done", cost: { usd: 0.0128 } }, { platform: "news", runId: "c", status: "done", cost: { usd: 0.05 } },
    { platform: "tiktok", runId: "d", status: "failed" }, { platform: "instagram", status: "failed" } ] };
  const c = jobCost(job);
  assert.equal(c.total_usd, 0.1828); assert.equal(c.apify_usd, 0.1628); assert.equal(c.brain_usd, 0.02);
  assert.deepEqual(c.by_platform, { news: 0.15, x: 0.0128 }); assert.equal(c.sources_tracked, 3); assert.equal(c.sources_untracked, 1); assert.equal(c.complete, false);
  const old = jobCost({ status: "complete", brain: { status: "done" }, sources: [{ platform: "news", runId: "a", status: "done", cost: { usd: 0.1 } }] });
  assert.equal(old.brain_usd, null); assert.equal(old.brain_tracked, false); assert.equal(old.brain_pending, false); assert.equal(old.complete, false); assert.equal(old.total_usd, 0.1);
  const running = jobCost({ status: "running", brain: { status: "pending" }, sources: [{ platform: "news", runId: "a", status: "running" }] });
  assert.equal(running.brain_pending, true); assert.equal(running.total_usd, 0);
});
