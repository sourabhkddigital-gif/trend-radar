// Source registry: which Apify actor to run per platform, for "topic" research and for "trending now",
// plus a normalizer that turns each actor's rows into the common item shape.
//
// Common item: { platform, region, topic (display text), url, metric, metric_label, comments?, likes?, extra?, published? (ISO), age_h?, growth?, direction?, curve?, related? }

const DAY = 86400000;
const isoDaysAgo = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
const num = v => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : null; };
const iso = v => { if (!v) return null; const d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v); return isNaN(d) ? null : d.toISOString(); };
const firstLine = (s, n = 140) => String(s || "").split(/\r?\n/).map(x => x.trim()).find(Boolean)?.slice(0, n) || "";
const latin = s => { const l = [...String(s)].filter(c => /\p{L}/u.test(c)); if (!l.length) return true; return l.filter(c => /[A-Za-zÀ-ɏ]/.test(c)).length / l.length >= 0.75; };
const redditId = url => (String(url).match(/comments\/([a-z0-9]+)/i) || [])[1];

export const PLATFORMS = {
  google:    { name: "Google Search", color: "#4285F4" },
  news:      { name: "Google News",   color: "#1A73E8" },
  youtube:   { name: "YouTube",       color: "#FF0000" },
  reddit:    { name: "Reddit",        color: "#FF4500" },
  x:         { name: "X",             color: "#000000" },
  tiktok:    { name: "TikTok",        color: "#000000" },
  instagram: { name: "Instagram",     color: "#E4405F" },
  pinterest: { name: "Pinterest",     color: "#BD081C" },
};

// Region → per-source codes
const REGION = {
  US: { trends: "US", news: "US:en", yt: "US", x: "23424977", tiktok: "US", gsearch: "us" },
  IN: { trends: "IN", news: "IN:en", yt: "IN", x: "IN", tiktok: "IN", gsearch: "in" },
  GB: { trends: "GB", news: "GB:en", yt: "GB", x: "23424975", tiktok: "GB", gsearch: "gb" },
  Global: { trends: "", news: "US:en", yt: "US", x: "worldwide", tiktok: "US", gsearch: "us" },
};

/** Build the list of actor runs for a job. mode: "topic" | "trending". window: 24|48|168 (hours). */
export function plan({ mode, topic, region = "US", windowH = 24, platforms }) {
  const R = REGION[region] || REGION.US;
  const want = new Set(platforms?.length ? platforms : Object.keys(PLATFORMS));
  const runs = [];
  const add = (platform, actor, input, opts = {}) => { if (want.has(platform)) runs.push({ platform, actor, input, ...opts }); };

  if (mode === "topic") {
    const t = topic.trim();
    add("news", "data_xplorer/google-news-scraper-fast",
      { keywords: [t], maxArticles: 25, timeframe: windowH <= 24 ? "1d" : "7d", region_language: R.news, decodeUrls: false, extractDescriptions: false, extractImages: false },
      { label: `Google News · ${region}` });
    add("google", "orbots/google-trends-scraper",
      { mode: "keywords", keywords: [t], geo: R.trends, timeframe: windowH <= 24 ? "now 1-d" : "now 7-d", dataTypes: ["interest_over_time"] },
      { label: "Google Trends", kind: "series" });
    add("reddit", "harshmaur/reddit-scraper",
      { searchTerms: [t], searchSort: "top", searchTime: windowH <= 24 ? "day" : "week", maxPostsCount: 30, includeNSFW: false, searchPosts: true, searchComments: false, searchCommunities: false, crawlCommentsPerPost: false },
      { label: "Reddit search" });
    add("youtube", "streamers/youtube-scraper",
      { searchQueries: [t], maxResults: 20, maxResultsShorts: 0, maxResultStreams: 0, sortingOrder: "views", dateFilter: windowH <= 24 ? "today" : "week" },
      { label: "YouTube search", slow: true });
    add("x", "apidojo/tweet-scraper",
      { searchTerms: [t], maxItems: 40, sort: "Top", tweetLanguage: "en", start: isoDaysAgo(Math.max(1, Math.round(windowH / 24))) },
      { label: "X top posts" });
    add("tiktok", "clockworks/tiktok-scraper",
      { searchQueries: [t], searchSection: "/video", resultsPerPage: 20, videoSearchSorting: "MOST_RELEVANT", videoSearchDateFilter: windowH <= 24 ? "PAST_24_HOURS" : "PAST_WEEK", proxyCountryCode: R.tiktok },
      { label: "TikTok search", slow: true });
    add("instagram", "apify/instagram-hashtag-scraper",
      { hashtags: [t], keywordSearch: true, resultsType: "reels", resultsLimit: 20 },
      { label: "Instagram reels" });
  } else {
    add("google", "orbots/google-trends-scraper",
      { mode: "trending", geo: R.trends || "US", trendingGeos: [R.trends || "US"], trendingHours: windowH <= 24 ? "24" : windowH <= 48 ? "48" : "168", maxItems: 100 },
      { label: `Google Trending Now · ${region}` });
    add("news", "data_xplorer/google-news-scraper-fast",
      { topics: ["WORLD", "BUSINESS", "TECHNOLOGY", "ENTERTAINMENT", "SPORTS"], maxArticles: 8, region_language: R.news, decodeUrls: false, extractDescriptions: false, extractImages: false },
      { label: "Google News" });
    add("reddit", "harshmaur/reddit-scraper",
      { startUrls: [{ url: `https://www.reddit.com/r/popular/top/?t=${windowH <= 24 ? "day" : "week"}` }], maxPostsCount: 60, includeNSFW: false, crawlCommentsPerPost: false, searchComments: false, searchCommunities: false },
      { label: "Reddit r/popular" });
    add("youtube", "akash9078/youtube-trending-scraper", { regionCode: R.yt, maxResults: 50 }, { label: `YouTube trending · ${R.yt}` });
    add("x", "automation-lab/twitter-trends-scraper", { locations: [R.x], maxTrendsPerLocation: 50 }, { label: `X trends · ${region}` });
    add("tiktok", "data_xplorer/tiktok-trends", { trendType: "hashtags", countryCode: ["US", "GB"].includes(region) ? region : "US", hashtagPeriod: "7", maxItems: 30 }, { label: "TikTok hashtags · 7d" });
    add("pinterest", "steadyfetch/social-trends-scraper", { platforms: ["pinterest"], country: ["US", "GB"].includes(region) ? region : "US", limitPerPlatform: 50, maxItems: 50 }, { label: "Pinterest trends", slow: true });
    add("instagram", "khadinakbar/instagram-trending-reels-scraper", { maxResults: 40, onlyReelsNewerThan: isoDaysAgo(2) }, { label: "Instagram trending reels", slow: true });
  }
  return runs;
}

/** Fields to request per actor (keeps dataset payloads small). */
export const FIELDS = {
  "data_xplorer/google-news-scraper-fast": ["title", "url", "source", "publishedAt"],
  "orbots/google-trends-scraper": ["type", "term", "keyword", "search_volume", "growth", "category", "started_at", "is_active", "related_terms", "timestamp", "value", "is_partial"],
  "harshmaur/reddit-scraper": ["dataType", "title", "postUrl", "upVotes", "commentsCount", "communityName", "createdAt", "over18"],
  "streamers/youtube-scraper": ["title", "url", "viewCount", "date", "likes", "channelName", "duration", "commentsCount", "type"],
  "akash9078/youtube-trending-scraper": ["title", "video_url", "channel_title", "published_at", "view_count", "like_count", "comment_count", "duration"],
  "apidojo/tweet-scraper": ["text", "url", "createdAt", "viewCount", "likeCount", "retweetCount", "replyCount", "author", "isRetweet", "lang"],
  "automation-lab/twitter-trends-scraper": ["rank", "name", "isPromoted"],
  "clockworks/tiktok-scraper": ["text", "webVideoUrl", "createTimeISO", "playCount", "diggCount", "commentCount", "shareCount", "authorMeta", "isAd", "textLanguage"],
  "data_xplorer/tiktok-trends": ["Rank", "Hashtag", "Posts", "Video Views", "Trend Direction", "Industries", "Trend Data"],
  "apify/instagram-hashtag-scraper": ["caption", "url", "timestamp", "likesCount", "commentsCount", "videoPlayCount", "ownerUsername", "type"],
  "khadinakbar/instagram-trending-reels-scraper": ["trendingFeedPosition", "caption", "creatorUsername", "likeCount", "commentCount", "postedAt", "shortcode"],
  "steadyfetch/social-trends-scraper": ["rank", "title", "url", "platform", "metricValue", "details", "status"],
};

/** Normalize raw dataset rows into common items. Returns {items, series?} */
export function normalize(run, rows, { region, windowH }) {
  const out = [];
  const P = run.platform;
  const push = it => { if (!it.topic || !latin(it.topic)) return; it.platform = P; it.region = it.region || region; it.topic = String(it.topic).trim(); if (it.published) { it.age_h = Math.round(((Date.now() - new Date(it.published)) / 36e5) * 10) / 10; } out.push(it); };

  switch (run.actor) {
    case "data_xplorer/google-news-scraper-fast":
      rows.forEach((r, i) => push({ topic: String(r.title || "").replace(/\s+-\s+[^-]+$/, ""), url: r.url, rank: i + 1, metric: null, metric_label: "", extra: r.source, published: iso(r.publishedAt) }));
      break;
    case "orbots/google-trends-scraper":
      if (run.kind === "series") {
        const pts = rows.filter(r => r.type === "interest_over_time").map(r => ({ t: r.timestamp, v: Number(r.value) || 0 }));
        return { items: [], series: { label: `Google search interest · ${rows[0]?.keyword || ""}`, points: pts } };
      }
      rows.forEach((r, i) => push({ topic: r.term, url: "https://www.google.com/search?q=" + encodeURIComponent(r.term || ""), rank: i + 1, metric: num(r.search_volume), metric_label: "searches", growth: num(r.growth), active: !!r.is_active, published: iso(r.started_at), related: (r.related_terms || []).slice(0, 3), src_cat: r.category }));
      break;
    case "harshmaur/reddit-scraper":
      rows.filter(r => (r.dataType || "post") === "post" && !r.over18).forEach((r, i) => push({ topic: r.title, url: r.postUrl, rank: i + 1, metric: num(r.upVotes), metric_label: "upvotes", comments: num(r.commentsCount), extra: r.communityName, published: iso(r.createdAt) }));
      break;
    case "streamers/youtube-scraper":
      rows.filter(r => r.title).forEach((r, i) => push({ topic: r.title, url: r.url, rank: i + 1, metric: num(r.viewCount), metric_label: "views", likes: num(r.likes), comments: num(r.commentsCount), extra: r.channelName, published: iso(r.date), duration: r.duration }));
      break;
    case "akash9078/youtube-trending-scraper":
      rows.forEach((r, i) => push({ topic: r.title, url: r.video_url, rank: i + 1, metric: num(r.view_count), metric_label: "views", likes: num(r.like_count), comments: num(r.comment_count), extra: r.channel_title, published: iso(r.published_at), duration: r.duration }));
      break;
    case "apidojo/tweet-scraper":
      rows.filter(r => !r.isRetweet && r.text && (!r.lang || ["en", "und", "qme", "zxx"].includes(r.lang))).forEach((r, i) => push({ topic: firstLine(r.text, 160), url: r.url, rank: i + 1, metric: num(r.viewCount), metric_label: "views", likes: num(r.likeCount), comments: num(r.replyCount), reposts: num(r.retweetCount), extra: r.author?.userName ? "@" + r.author.userName + (r.author.followers ? ` · ${fmtK(r.author.followers)} followers` : "") : "", published: iso(r.createdAt) }));
      break;
    case "automation-lab/twitter-trends-scraper":
      rows.filter(r => r.name && !r.isPromoted).forEach((r, i) => push({ topic: r.name, url: "https://x.com/search?q=" + encodeURIComponent(r.name), rank: r.rank || i + 1, metric: null, metric_label: "", hashtag: String(r.name).startsWith("#") }));
      break;
    case "clockworks/tiktok-scraper":
      rows.filter(r => !r.isAd && (r.text || r.webVideoUrl) && (!r.textLanguage || ["en", "un", ""].includes(r.textLanguage))).forEach((r, i) => push({ topic: firstLine(r.text, 140) || "(video)", url: r.webVideoUrl, rank: i + 1, metric: num(r.playCount), metric_label: "plays", likes: num(r.diggCount), comments: num(r.commentCount), shares: num(r.shareCount), extra: r.authorMeta?.name ? "@" + r.authorMeta.name + (r.authorMeta.fans ? ` · ${fmtK(r.authorMeta.fans)} followers` : "") : "", published: iso(r.createTimeISO), lang: r.textLanguage }));
      break;
    case "data_xplorer/tiktok-trends":
      rows.forEach((r, i) => push({ topic: r.Hashtag, url: "https://www.tiktok.com/tag/" + String(r.Hashtag || "").replace("#", ""), rank: r.Rank || i + 1, metric: num(r["Video Views"]), metric_label: "views", posts: num(r.Posts), direction: r["Trend Direction"], curve: (r["Trend Data"] || []).map(p => Math.round(Number(p.value) || 0)), industries: r.Industries || [] }));
      break;
    case "apify/instagram-hashtag-scraper":
      rows.filter(r => r.url).forEach((r, i) => push({ topic: firstLine(r.caption, 140) || "(reel)", url: r.url, rank: i + 1, metric: num(r.videoPlayCount) ?? num(r.likesCount), metric_label: r.videoPlayCount ? "plays" : "likes", likes: num(r.likesCount), comments: num(r.commentsCount), extra: r.ownerUsername ? "@" + r.ownerUsername : "", published: iso(r.timestamp) }));
      break;
    case "khadinakbar/instagram-trending-reels-scraper":
      rows.forEach((r, i) => push({ topic: firstLine(r.caption, 140) || "(reel)", url: r.shortcode ? `https://www.instagram.com/reel/${r.shortcode}/` : r.reelUrl, rank: r.trendingFeedPosition || i + 1, metric: num(r.likeCount), metric_label: "likes", comments: num(r.commentCount), extra: r.creatorUsername ? "@" + r.creatorUsername : "", published: iso(r.postedAt) }));
      break;
    case "steadyfetch/social-trends-scraper":
      rows.filter(r => r.title && (r.status || "ok") === "ok").forEach((r, i) => push({ topic: r.title, url: r.url, rank: r.rank || i + 1, metric: num(r.metricValue), metric_label: "search index", wow: num(r.details?.wowChange?.value), mom: num(r.details?.momChange?.value) }));
      break;
    default:
      rows.forEach((r, i) => push({ topic: r.title || r.text || r.name, url: r.url, rank: i + 1 }));
  }
  // drop items outside the window when the date is known (X trend ranks, TikTok hashtags and Pinterest have no dates)
  const items = out.filter(it => it.age_h == null || it.age_h <= windowH + 3);
  return { items };
}

function fmtK(n) { n = Number(n); return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n); }
