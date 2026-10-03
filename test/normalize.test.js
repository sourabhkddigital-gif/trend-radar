import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, normalize, FIELDS, fixUrl, searchUrl } from "../lib/sources.js";
import { scoreItems, buildClusters } from "../lib/score.js";
import { buildPrompt } from "../lib/brain.js";
import { fixtures } from "./fixtures.js";

const F = fixtures();
const ctx = { region: "US", windowH: 24 };

test("plan builds one run per platform in both modes and every actor has a field list", () => {
  const topic = plan({ mode: "topic", topic: "AI automation", region: "IN", windowH: 24 });
  const trend = plan({ mode: "trending", region: "US", windowH: 24 });
  assert.equal(topic.length, 8); assert.equal(trend.length, 9);
  for (const r of [...topic, ...trend]) assert.ok(FIELDS[r.actor], "fields for " + r.actor);
  assert.equal(topic.find(r => r.platform === "news").input.region_language, "IN:en");
  assert.equal(trend.find(r => r.platform === "x").input.locations[0], "23424977");
  assert.equal(plan({ mode: "topic", topic: "x", platforms: ["reddit"] }).length, 1);
});

test("news normalizes and strips the trailing source from titles", () => {
  const { items } = normalize({ platform: "news", actor: "data_xplorer/google-news-scraper-fast" }, F["data_xplorer/google-news-scraper-fast"], ctx);
  assert.equal(items.length, 3);
  assert.equal(items[0].topic, "Why AI, Automation, & Data Are Critical for Manufacturers");
  assert.ok(items[0].age_h >= 2.9 && items[0].age_h <= 3.2);
});

test("google keywords mode returns a series, trending mode returns items with growth", () => {
  const s = normalize({ platform: "google", actor: "orbots/google-trends-scraper", kind: "series" }, F["orbots/google-trends-scraper"], ctx);
  assert.equal(s.items.length, 0); assert.equal(s.series.points.length, 5); assert.equal(s.series.points[4].v, 100);
  const t = normalize({ platform: "google", actor: "orbots/google-trends-scraper" }, F["orbots/google-trends-scraper#trending"], ctx);
  assert.equal(t.items.length, 2); assert.equal(t.items[0].metric, 5000000); assert.equal(t.items[0].growth, 1000); assert.ok(t.items[0].published);
});

test("reddit drops NSFW, keeps metrics", () => {
  const { items } = normalize({ platform: "reddit", actor: "harshmaur/reddit-scraper" }, F["harshmaur/reddit-scraper"], ctx);
  assert.equal(items.length, 3); assert.equal(items[1].metric, 1402); assert.equal(items[1].comments, 876); assert.equal(items[1].extra, "r/ExperiencedDevs");
});

test("youtube search drops rows older than the window", () => {
  const { items } = normalize({ platform: "youtube", actor: "streamers/youtube-scraper" }, F["streamers/youtube-scraper"], ctx);
  assert.deepEqual(items.map(i => i.metric), [122292, 52647]);
});

test("x drops retweets and promoted trends; parses twitter dates", () => {
  const { items } = normalize({ platform: "x", actor: "apidojo/tweet-scraper" }, F["apidojo/tweet-scraper"], { region: "US", windowH: 168 });
  assert.equal(items.length, 2); assert.ok(items[0].published.startsWith("2026-09-29T10:13")); assert.equal(items[0].extra, "@Origin_AI_01 · 10K followers");
  const tr = normalize({ platform: "x", actor: "automation-lab/twitter-trends-scraper" }, F["automation-lab/twitter-trends-scraper"], ctx);
  assert.deepEqual(tr.items.map(i => i.topic), ["Good Wednesday", "Cubs"]);
});

test("tiktok search keeps english + hashtag-only captions, drops non-latin; hashtags carry curves", () => {
  const { items } = normalize({ platform: "tiktok", actor: "clockworks/tiktok-scraper" }, F["clockworks/tiktok-scraper"], ctx);
  assert.equal(items.length, 2); assert.equal(items[0].metric_label, "plays");
  const tags = normalize({ platform: "tiktok", actor: "data_xplorer/tiktok-trends" }, F["data_xplorer/tiktok-trends"], ctx);
  assert.equal(tags.items[0].curve.length, 7); assert.equal(tags.items[0].direction, "up");
});

test("instagram + pinterest normalize; pinterest status row dropped", () => {
  const ig = normalize({ platform: "instagram", actor: "apify/instagram-hashtag-scraper" }, F["apify/instagram-hashtag-scraper"], ctx);
  assert.equal(ig.items.length, 2); assert.equal(ig.items[0].topic, "Earn With AI Agents 🤖💰"); assert.equal(ig.items[0].metric_label, "plays");
  const pin = normalize({ platform: "pinterest", actor: "steadyfetch/social-trends-scraper" }, F["steadyfetch/social-trends-scraper"], ctx);
  assert.equal(pin.items.length, 1); assert.equal(pin.items[0].mom, 100.01);
});

test("scoring assigns reach/momentum/score/category and clusters build from brain output", () => {
  const all = [];
  for (const [actor, platform] of [["data_xplorer/google-news-scraper-fast", "news"], ["harshmaur/reddit-scraper", "reddit"], ["streamers/youtube-scraper", "youtube"], ["apidojo/tweet-scraper", "x"]]) {
    all.push(...normalize({ platform, actor }, F[actor], { region: "US", windowH: 168 }).items);
  }
  scoreItems(all, { windowH: 168 });
  assert.ok(all.every(i => i.score >= 0 && i.score <= 100 && i.id && i.category));
  assert.equal(all.find(i => i.topic.startsWith("EliseAI raises")).category, "Business");
  const brain = { clusters: [{ id: "c1", name: "EliseAI $350M raise", category: "Business", safety: "safe", why: "w", angles: ["a"], formats: ["Thread"], item_ids: all.filter(i => i.topic.includes("EliseAI")).map(i => i.id) },
    { id: "c2", name: "Nope", item_ids: ["does-not-exist"] }] };
  const clusters = buildClusters(all, brain, { windowH: 168 });
  assert.equal(clusters.length, 1); assert.equal(clusters[0].n_items, 2); assert.ok(clusters[0].score > 0); assert.equal(clusters[0].platforms[0], "news");
  const prompt = buildPrompt({ mode: "topic", topic: "AI automation", region: "US", windowH: 24, items: all, series: null });
  assert.ok(prompt.includes("news-1 |") && prompt.includes("Return ONLY JSON"));
});

test("every item gets an absolute link: bad or missing URLs fall back to the platform's own search", () => {
  assert.equal(fixUrl("reddit", "/r/running/comments/abc/x/", "t"), "https://www.reddit.com/r/running/comments/abc/x/");
  assert.equal(fixUrl("x", "//x.com/a/status/1", "t"), "https://x.com/a/status/1");
  assert.equal(fixUrl("youtube", "www.youtube.com/watch?v=1", "t"), "https://www.youtube.com/watch?v=1");
  assert.equal(fixUrl("tiktok", "", "running shoes"), searchUrl("tiktok", "running shoes"));
  assert.equal(fixUrl("news", undefined, "e-bikes"), "https://news.google.com/search?q=e-bikes");
  assert.equal(fixUrl("instagram", "javascript:alert(1)", "x"), searchUrl("instagram", "x"));
  const { items } = normalize({ platform: "tiktok", actor: "clockworks/tiktok-scraper" }, [{ text: "no link here", playCount: 5 }], ctx);
  assert.equal(items.length, 1); assert.ok(items[0].url.startsWith("https://www.tiktok.com/search?q="));
});

test("the focus brief steers the prompt and the off-topic rule; without it the prompt is unchanged", () => {
  const items = [{ id: "news-1", platform: "news", region: "US", topic: "Nike Apex launch", rank: 1 }];
  const plain = buildPrompt({ mode: "topic", topic: "running shoes", region: "US", windowH: 24, items });
  const focused = buildPrompt({ mode: "topic", topic: "running shoes", brief: "marathon racing shoes; ignore fashion sneakers", region: "US", windowH: 24, items });
  assert.ok(!plain.includes("FOCUS BRIEF")); assert.ok(plain.includes("Expect well under a third"));
  assert.ok(focused.includes("FOCUS BRIEF")); assert.ok(focused.includes("ignore fashion sneakers")); assert.ok(!focused.includes("Expect well under a third"));
  assert.ok(!buildPrompt({ mode: "trending", topic: "", brief: "x", region: "US", windowH: 24, items }).includes("FOCUS BRIEF"));
});

test("github: repos ranked by star velocity, forks and duplicates dropped, non-English descriptions filtered", () => {
  const run = { platform: "github", actor: "rupom888/github-repository-scraper" };
  const { items } = normalize(run, F["rupom888/github-repository-scraper"], ctx);
  const names = items.map(i => i.topic.split(" — ")[0]);
  assert.deepEqual(names, ["feder-cr/dots", "zai-org/ZCode", "kaankiziltug/logo-design-skill", "LockedinLabs-AI/agent-console", "langgenius/dify"]);
  const dots = items[0];
  assert.equal(dots.metric, 2543); assert.equal(dots.metric_label, "stars"); assert.equal(dots.url, "https://github.com/feder-cr/dots");
  assert.ok(dots.stars_per_day > 700); assert.match(dots.extra, /new · \dd old/); assert.equal(dots.age_h, undefined); // repo age never trips the window filter
  const scored = scoreItems(items, { windowH: 24 });
  assert.equal(scored[0].category, "Tech & AI"); assert.ok(scored[0].momentum >= 16); assert.equal(scored.find(i => i.topic.startsWith("langgenius")).momentum, 16); // huge but old: rising, not new
  assert.match(searchUrl("github", "ai agents"), /^https:\/\/github\.com\/search\?q=ai%20agents&type=repositories/);
});

test("github is planned in both modes with a date-qualified search", () => {
  const topic = plan({ mode: "topic", topic: "ai agents", windowH: 48, platforms: ["github"] });
  assert.equal(topic.length, 1); assert.equal(topic[0].actor, "rupom888/github-repository-scraper");
  assert.match(topic[0].input.queries[0], /^ai agents created:>=\d{4}-\d{2}-\d{2}$/); assert.match(topic[0].input.queries[1], /^ai agents pushed:>=\d{4}-\d{2}-\d{2}$/);
  const trend = plan({ mode: "trending", windowH: 24, platforms: ["github"] });
  assert.match(trend[0].input.queries[0], /^created:>=/);
});
