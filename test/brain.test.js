import { test } from "node:test";
import assert from "node:assert/strict";
import { runBrain } from "../lib/brain.js";
import { brainError } from "../lib/jobs.js";

const answer = JSON.stringify({ summary: "s", clusters: [{ id: "c1", name: "n", item_ids: ["a"] }], offtopic: [], next_queries: ["q"] });
const stub = handler => { const real = globalThis.fetch, calls = []; globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers || {} }); const [status, body] = handler(String(url), calls.length); return { ok: status < 300, status, statusText: "x", json: async () => body }; }; return { calls, undo: () => { globalThis.fetch = real; } }; };

test("Claude direct: Anthropic Messages API first, cost = tokens × list price", async () => {
  const { calls, undo } = stub(() => [200, { id: "msg_1", model: "claude-sonnet-5-5", content: [{ type: "text", text: answer }], usage: { input_tokens: 10000, output_tokens: 2000 }, stop_reason: "end_turn" }]);
  try {
    const out = await runBrain({ anthropicKey: "sk-ant-x", apiKey: "sk-or-x", prompt: "p" });
    assert.equal(out.provider, "anthropic"); assert.equal(out.model, "claude-sonnet-5-5"); assert.equal(out.clusters.length, 1);
    assert.equal(out.cost.usd, 0.04); // 10K × $2/M + 2K × $10/M
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages"); assert.equal(calls[0].headers["x-api-key"], "sk-ant-x"); assert.equal(calls[0].body.model, "claude-sonnet-5-5");
  } finally { undo(); }
});

test("out of Anthropic credits → straight to OpenRouter (no second Claude model), and the reverse error reads plainly", async () => {
  const { calls, undo } = stub(url => url.includes("anthropic") ? [400, { error: { message: "Your credit balance is too low to access the Anthropic API." } }] : [200, { id: "gen-1", model: "anthropic/claude-sonnet-4.5", choices: [{ message: { content: answer } }], usage: { cost: 0.05 } }]);
  try {
    const out = await runBrain({ anthropicKey: "k", apiKey: "o", prompt: "p" });
    assert.equal(out.provider, "openrouter"); assert.equal(out.cost.usd, 0.05); assert.equal(calls.filter(c => c.url.includes("anthropic")).length, 1);
  } finally { undo(); }
  const e = brainError("Anthropic 400 (claude-sonnet-5-5): Your credit balance is too low · OpenRouter 402 (anthropic/claude-sonnet-4.5): This request requires more credits");
  assert.match(e, /Anthropic \(Claude\) account is out of credits/); assert.match(e, /OpenRouter account is out of credits/);
});

test("a malformed Claude answer falls back to Haiku before giving up on Anthropic", async () => {
  const { calls, undo } = stub((url, n) => [200, { model: n === 1 ? "claude-sonnet-5-5" : "claude-haiku-4-5-20251001", content: [{ type: "text", text: n === 1 ? "not json" : answer }], usage: { input_tokens: 1000, output_tokens: 100 } }]);
  try { const out = await runBrain({ anthropicKey: "k", prompt: "p" }); assert.equal(out.model, "claude-haiku-4-5-20251001"); assert.equal(calls[1].body.model, "claude-haiku-4-5-20251001"); assert.equal(out.cost.usd, 0.0015); }
  finally { undo(); }
});
