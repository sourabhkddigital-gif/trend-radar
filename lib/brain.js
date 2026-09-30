// The editorial layer: clusters items into signals, writes why/angles, flags brand safety. Uses OpenRouter.
import { CATEGORIES } from "./score.js";

const OR = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
const FALLBACK_MODELS = ["openai/gpt-4o-mini", "google/gemini-2.5-flash", "openrouter/auto"];

const fmt = n => n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);

export function buildPrompt({ mode, topic, region, windowH, items, series }) {
  const lines = items.slice(0, 150).map(it => {
    const m = it.metric ? `${fmt(it.metric)} ${it.metric_label}` : `rank ${it.rank}`;
    const bits = [it.platform, it.region, m, it.age_h != null ? `${Math.round(it.age_h)}h ago` : "", it.growth ? `+${it.growth}%` : "", it.direction ? it.direction : "", it.extra || ""].filter(Boolean).join(" · ");
    return `${it.id} | ${bits} | ${it.topic.replace(/\s+/g, " ").slice(0, 150)}`;
  });
  const seriesNote = series?.points?.length ? `Google search interest for the topic over the window (0-100, hourly, oldest→newest): ${series.points.map(p => p.v).join(",")}` : "";
  const focus = mode === "topic"
    ? `The user is researching the topic "${topic}". Items were fetched by searching each platform for it; some will be off-topic noise.`
    : `The user wants what is trending across platforms right now (no specific topic).`;
  return `You are the editorial brain of Trend Radar, a tool used by a marketing agency to find what is trending right now and turn it into content ideas for clients.

${focus} Region focus: ${region}. Time window: last ${windowH} hours. Today: ${new Date().toISOString().slice(0, 10)}.
${seriesNote}

ITEMS (id | platform · region · metric · age · extra | text):
${lines.join("\n")}

TASK
1. Group items that are the same story, theme or angle into SIGNALS. A signal ideally spans 2+ platforms; single-platform signals are fine when strong. Aim for 8–14 signals. Leave weak leftovers unassigned. Be concise: no prose outside the JSON fields.
2. Put in "offtopic" ONLY items that are clearly unrelated to the topic, spam, ads or non-English. Weak-but-related items are NOT off-topic: leave them unassigned instead. Expect well under a third of items to be off-topic.
3. For each signal write: name (≤80 chars, specific, no clickbait), category (one of: ${CATEGORIES.join(", ")}), safety ("safe" = brands can post about it; "caution" = politics, breaking news, weather, live legal matters, controversy; "avoid" = deaths, tragedies, crimes, personal scandals, recalls), why (ONE sentence with the numbers that prove it is trending now), angles (2–3 concrete content hooks an agency could execute today, naming the client type each suits), formats (1–4 from: Reel, Short, TikTok, X post, Thread, Carousel, Pinterest pins, Story, Email, LinkedIn post, Blog, Event, UGC brief, Hold), item_ids.
4. Write a 2–3 sentence "summary" of what is happening around ${mode === "topic" ? `"${topic}"` : "the internet"} right now, in plain, specific language with numbers.
5. Suggest 5 "next_queries": narrower or adjacent topics worth researching next.

Return ONLY JSON: {"summary": "...", "clusters": [{"id":"c1","name":"...","category":"...","safety":"safe","why":"...","angles":["..."],"formats":["..."],"item_ids":["..."]}], "offtopic": ["id", ...], "next_queries": ["..."]}`;
}

/** Total wall-clock budget for the analysis (all model attempts). Must fit inside the api/job function's maxDuration. */
export const BRAIN_BUDGET_MS = Number(process.env.BRAIN_BUDGET_MS || 240000);

export async function runBrain({ apiKey, model, prompt, appUrl = "https://trend-radar.vercel.app", budgetMs = BRAIN_BUDGET_MS }) {
  const models = [model || DEFAULT_MODEL, ...FALLBACK_MODELS.filter(m => m !== (model || DEFAULT_MODEL))];
  const deadline = Date.now() + budgetMs;
  let lastErr = null;
  for (const m of models) {
    const left = deadline - Date.now();
    if (left < 20000) { lastErr = lastErr || new Error("Analysis ran out of time"); break; }
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), Math.min(left - 5000, 150000));
      const res = await fetch(OR, {
        method: "POST", signal: ctrl.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": appUrl, "X-Title": "Trend Radar" },
        body: JSON.stringify({ model: m, temperature: 0.3, max_tokens: 4500, response_format: { type: "json_object" },
          messages: [{ role: "system", content: "You return strictly valid JSON and nothing else." }, { role: "user", content: prompt }] }),
      }).finally(() => clearTimeout(t));
      const json = await res.json().catch(() => null);
      if (!res.ok) { lastErr = new Error(`OpenRouter ${res.status} (${m}): ${json?.error?.message || res.statusText}`); if (res.status === 401 || res.status === 402) throw lastErr; continue; }
      const text = json?.choices?.[0]?.message?.content || "";
      const parsed = parseJson(text);
      if (!parsed || !Array.isArray(parsed.clusters)) { lastErr = new Error(`Model ${m} returned no clusters`); continue; }
      return { ...parsed, model: json.model || m };
    } catch (e) { lastErr = e.name === "AbortError" ? new Error(`Model ${m} timed out`) : e; if (/401|402/.test(String(e.message))) break; }
  }
  throw lastErr || new Error("Brain failed");
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
