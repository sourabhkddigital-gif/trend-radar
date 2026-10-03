// Scoring + assembly of the final result (mirrors the V2 dashboard formula).
export const CATEGORIES = ["Sports", "Entertainment", "Music", "Gaming", "Tech & AI", "Business", "Politics & Law", "Lifestyle & Seasonal", "Fashion & Beauty", "Food & Drink", "Science & Nature", "News & Weather", "Health", "Culture & Creators", "Other"];
const PLATFORM_W = { google: 30, news: 24, reddit: 26, youtube: 26, x: 22, tiktok: 26, pinterest: 18, instagram: 20, github: 22 };
const SAFETY_PEN = { safe: 0, caution: 25, avoid: 60 };
const GOOGLE_CAT = { Sports: "Sports", Entertainment: "Entertainment", Politics: "Politics & Law", "Law and Government": "Politics & Law", Health: "Health", Science: "Science & Nature", Climate: "News & Weather", Technology: "Tech & AI", "Business and Finance": "Business", Games: "Gaming", "Food and Drink": "Food & Drink", "Jobs and Education": "Business", Shopping: "Business" };
const KW = [
  [/official music video|music video|\(official video\)|visualizer|lyric video|acoustic|remix|unreleased|vevo|\bfeat\.|\bft\.|\bsong\b|\balbum\b/i, "Music"],
  [/minecraft|roblox|\bgame|gaming|fortnite|stream|twitch|esports|playstation|xbox|steam|gameplay/i, "Gaming"],
  [/trailer|netflix|hulu|apple tv|paramount|episode|season|movie|film|series|show\b|actor|actress/i, "Entertainment"],
  [/nail|outfit|fashion|style|wallpaper|costume|beauty|skincare|makeup/i, "Fashion & Beauty"],
  [/recipe|food|seafood|pizza|burger|coffee|snack|restaurant|drink/i, "Food & Drink"],
  [/\bvs\b|score|match|league|playoff|nba|nfl|nhl|mlb|odi|cricket|goal|team|final\b/i, "Sports"],
  [/ipo|stock|sensex|bank|tax|business|market|revenue|funding|raises|valuation|startup|acquires|acquisition/i, "Business"],
  [/\bai\b|openai|chatgpt|claude|gpt|iphone|app\b|tech|software|automation|robot/i, "Tech & AI"],
  [/minister|election|party|senate|congress|police|court|trial|government|president|law\b/i, "Politics & Law"],
  [/weather|storm|flood|cyclone|earthquake|hurricane|rain/i, "News & Weather"],
  [/cat\b|dog\b|kitten|penguin|animal|nature|science|space|nasa/i, "Science & Nature"],
];

export function kwCategory(text) { for (const [re, c] of KW) if (re.test(text)) return c; return "Other"; }

function momentum(it, windowH) {
  const p = it.platform;
  if (p === "google" && it.growth != null) { const g = it.growth; const b = g >= 1000 ? 20 : g >= 500 ? 14 : 8; return it.active ? b : b - 6; }
  if (p === "tiktok" && it.direction) { const c = it.curve || []; const rising = c.length && c[c.length - 1] >= Math.max(...c.slice(0, -1), 0); return it.direction === "up" && rising ? 18 : it.direction === "up" ? 12 : 2; }
  if (p === "github") { const v = it.trend_vel ?? it.stars_per_day ?? 0; return v >= 100 ? 20 : v >= 20 ? 16 : v >= 5 ? 12 : (it.repo_age_d ?? 999) <= 30 ? 10 : 6; }
  if (p === "pinterest") return (it.wow || 0) >= 50 ? 18 : (it.mom || 0) >= 70 ? 12 : 8;
  if (it.age_h != null) { const a = it.age_h, w = windowH; return a <= w * 0.25 ? 18 : a <= w * 0.5 ? 14 : a <= w ? 10 : 4; }
  if (p === "x") return it.rank <= 10 ? 14 : 8;
  return 8;
}

/** Add reach/momentum/score/category to items. Mutates and returns items. */
export function scoreItems(items, { windowH = 24 } = {}) {
  const byP = {};
  items.forEach(it => (byP[it.platform] ||= []).push(it));
  for (const list of Object.values(byP)) {
    list.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    list.forEach((it, i) => { it.reach = Math.round((1 - i / Math.max(list.length, 1)) * 1000) / 1000; });
  }
  items.forEach((it, i) => {
    it.id = it.id || `${it.platform}-${i + 1}`;
    it.momentum = momentum(it, windowH);
    it.category = it.category || GOOGLE_CAT[it.src_cat] || (it.platform === "github" ? "Tech & AI" : null) || kwCategory([it.topic, ...(it.related || []), it.extra || ""].join(" "));
    it.safety = it.safety || "safe";
    delete it.src_cat;
    const s = it.reach * 50 + it.momentum + (PLATFORM_W[it.platform] || 20) * 0.3 - SAFETY_PEN[it.safety];
    it.score = Math.max(0, Math.min(100, Math.round(s)));
  });
  return items;
}

/** Turn brain clusters (with item_ids) into scored signal objects. */
export function buildClusters(items, brain, { windowH = 24 } = {}) {
  const byId = new Map(items.map(it => [it.id, it]));
  const clusters = [];
  for (const c of brain.clusters || []) {
    const members = (c.item_ids || []).map(id => byId.get(id)).filter(Boolean);
    if (!members.length) continue;
    const safety = ["safe", "caution", "avoid"].includes(c.safety) ? c.safety : "safe";
    const category = CATEGORIES.includes(c.category) ? c.category : kwCategory(c.name || "");
    members.forEach(m => { m.cluster = c.id; m.category = category; m.safety = safety; });
    const plats = [...new Set(members.map(m => m.platform))];
    const regions = [...new Set(members.map(m => m.region))];
    const reach = Math.max(...members.map(m => m.reach)) * 36;
    const breadth = Math.min(2, plats.length - 1) * 12 + (regions.length >= 2 ? 4 : 0);
    const mom = Math.max(...members.map(m => m.momentum));
    const big = Math.max(0, ...members.filter(m => m.metric && ["google", "youtube", "tiktok", "reddit", "x", "instagram"].includes(m.platform)).map(m => m.metric));
    const volume = big ? Math.max(0, Math.min(10, (Math.log10(big) - 3) / 4 * 10)) : 0;
    const score = Math.max(0, Math.min(100, Math.round(reach + breadth + mom + volume - SAFETY_PEN[safety])));
    const evidence = [...members].sort((a, b) => b.reach - a.reach).slice(0, 6).map(m => ({ id: m.id, platform: m.platform, region: m.region, topic: m.topic, url: m.url, metric: m.metric, metric_label: m.metric_label, rank: m.rank }));
    clusters.push({ id: c.id, name: c.name, category, safety, why: c.why || "", angles: c.angles || [], formats: c.formats || [], platforms: plats, regions, n_items: members.length, score, momentum: mom, evidence });
  }
  // re-score members with their cluster safety
  scoreItems(items, { windowH });
  return clusters.sort((a, b) => b.score - a.score);
}
