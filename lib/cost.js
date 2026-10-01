// Cost tracking: what each research costs — Apify credits per platform run, OpenRouter credits for the AI step.
// Apify: every run object carries the pricing model of the actor and what was charged (per event / per result
// counts and the platform usage in USD). OpenRouter: the chat completion reports its cost when asked to.
// Everything is in USD, as both providers bill in USD.

export const round6 = n => Math.round((Number(n) || 0) * 1e6) / 1e6;
const num = v => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));

/** Price of one charge event of a pay-per-event actor, whatever shape Apify puts it in. */
function eventPrice(ev, tier) {
  if (!ev) return 0;
  if (num(ev.eventPriceUsd) != null) return num(ev.eventPriceUsd);
  const tiers = ev.eventTieredPricingUsd || ev.tieredPricing || null;
  if (tiers && typeof tiers === "object") {
    const pick = (tier && tiers[tier]) || tiers.BRONZE || tiers.FREE || Object.values(tiers)[0];
    const p = pick && typeof pick === "object" ? (pick.tieredEventPriceUsd ?? pick.priceUsd ?? pick.eventPriceUsd) : pick;
    if (num(p) != null) return num(p);
  }
  return 0;
}

/**
 * What the user paid for one Apify run, from the raw run object (`GET /v2/actor-runs/{id}`).
 * itemCount: number of dataset items, needed only for pay-per-result actors.
 */
export function runCost(run, { itemCount = null } = {}) {
  const pi = run?.pricingInfo || {};
  const model = pi.pricingModel || null;
  const tier = run?.pricingTier || pi.pricingTier || null;
  const usage = round6(run?.usageTotalUsd); // platform usage in USD as Apify reports it (on newer accounts this already includes the event/result charges)
  let charged = 0, detail = null;
  if (model === "PAY_PER_EVENT") {
    const events = pi.pricingPerEvent?.actorChargeEvents || {};
    detail = {};
    for (const [name, count] of Object.entries(run?.chargedEventCounts || {})) {
      const price = eventPrice(events[name], tier), n = Number(count) || 0;
      detail[name] = { count: n, price_usd: price, usd: round6(n * price) };
      charged += n * price;
    }
  } else if (model === "PRICE_PER_DATASET_ITEM") {
    const price = num(pi.pricePerUnitUsd) ?? eventPrice(pi, tier) ?? 0, n = Number(itemCount) || 0;
    detail = { items: n, price_usd: price, usd: round6(n * price) };
    charged = n * price;
  }
  // Where Apify's usageTotalUsd includes the per-event/per-result charges it is the larger number and the truth;
  // where it only counts platform usage (which the actor's developer pays for on those pricing models) the
  // computed charges are what the user pays. The larger of the two is right in both cases.
  const usd = round6(Math.max(usage, charged));
  return { usd, model, usage_usd: usage, charged_usd: round6(charged), detail, tier };
}

/** Cost of the AI step from an OpenRouter chat completion response (needs `usage: { include: true }` in the request). */
export function brainCost(json) {
  const u = json?.usage || {};
  const cost = num(u.cost ?? u.total_cost);
  return { usd: cost == null ? null : round6(cost), prompt_tokens: num(u.prompt_tokens) ?? num(u.tokens_prompt), completion_tokens: num(u.completion_tokens) ?? num(u.tokens_completion), gen_id: json?.id || null };
}

/** Roll the per-source and brain costs of a job up into one summary (stored as job.cost). */
export function jobCost(job) {
  const by_platform = {}; let apify = 0, tracked = 0, untracked = 0;
  for (const s of job.sources || []) {
    if (s.cost && num(s.cost.usd) != null) { by_platform[s.platform] = round6((by_platform[s.platform] || 0) + s.cost.usd); apify += s.cost.usd; tracked++; }
    else if (s.runId && s.status !== "running") untracked++;
  }
  const brain = num(job.brain?.cost_usd);
  const brainDone = ["done", "failed"].includes(job.brain?.status);
  const total = round6(apify + (brain || 0));
  return { total_usd: total, apify_usd: round6(apify), brain_usd: brain, by_platform, sources_tracked: tracked, sources_untracked: untracked,
    brain_tracked: brain != null, brain_pending: !brainDone && job.brain?.status !== "skipped", complete: job.status !== "running" && untracked === 0 && (brain != null || !brainDone) };
}
