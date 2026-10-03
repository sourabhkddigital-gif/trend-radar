# Trend Radar

Type any topic — a brand, a theme, a niche — and Trend Radar searches **Google News, Google Trends, Reddit, YouTube, X, TikTok, Instagram and GitHub** for the last 24 h / 48 h / 7 days, groups what it finds into **signals**, flags **brand safety**, and writes the **content angles** a marketing team can act on today. A second mode scans what's trending across all platforms without a topic.

Every research run gets a shareable link (`/r/<id>`). Results are stored in your Apify account, so there is no database to set up.

**Stack:** static HTML + three Vercel serverless functions. No framework, no build step, zero npm dependencies.
**Data:** [Apify](https://apify.com) actors (pay-per-result; roughly $0.30–0.60 per topic research).
**Analysis:** any model on [OpenRouter](https://openrouter.ai) (a few cents per run).

## Deploy in 10 minutes

1. **Get keys**
   - Apify: console.apify.com → Settings → *API & Integrations* → copy the token. Add some credit (a $5 top-up covers ~10 researches).
   - OpenRouter: openrouter.ai → *Keys* → create one, add a few dollars.
2. **Put this repo on GitHub** (fork it, or push this folder to a new repo).
3. **Import into Vercel**: vercel.com → *Add New → Project* → pick the repo → Framework preset **Other** → *Deploy*.
4. **Add environment variables** (Project → Settings → Environment Variables), then redeploy:

   | Variable | Required | What it does |
   |---|---|---|
   | `APIFY_TOKEN` | yes* | Runs the scrapers and stores results |
   | `OPENROUTER_API_KEY` | recommended | Signals, angles, summaries. Without it you get raw results only |
   | `OPENROUTER_MODEL` | no | Default `anthropic/claude-sonnet-4.5`. Any OpenRouter model id |
   | `ACCESS_CODE` | no | Leave unset for an **open site** — anyone with the URL can search, and the two limits below cap what it can cost you. If set, starting a research needs the code (viewing is always open); share `https://your-site/?k=<code>` as an invite link that saves it silently |
   | `DAILY_LIMIT` | no | Max researches per rolling 24 h on the shared keys, all visitors combined (default 0 = unlimited) |
   | `IP_DAILY_LIMIT` | no | Max researches per visitor (hashed IP) per rolling 24 h (default 0 = unlimited) |
   | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | no | Set automatically by the Vercel ↔ Supabase integration; enables the report archive and the History page |
| `REUSE_HOURS` | no | Same topic/region/window asked again within N hours reuses the existing research instead of paying twice (default 2) |
   | `KV_STORE_NAME` | no | Apify key-value store name for saved results (default `trend-radar-jobs`) |
   | `APP_NAME` | no | Display name |

   \*You can also leave `APIFY_TOKEN` empty and let each visitor bring their own keys via ⚙ Settings (keys stay in their browser and are sent per request, never stored).

That's it. Open the site, type a topic, press Research.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sourabhkddigital-gif/trend-radar&env=APIFY_TOKEN,OPENROUTER_API_KEY,ACCESS_CODE&envDescription=Apify%20token%20runs%20the%20scrapers%2C%20OpenRouter%20key%20powers%20the%20analysis%2C%20access%20code%20protects%20your%20credits)

## How it works

```
POST /api/research   → validates keys, starts one Apify actor run per platform, saves the job
GET  /api/job?id=…   → polled by the page every 3.5 s: collects finished datasets, normalizes rows,
                        scores them; when all sources are in, sends titles+metrics to the model,
                        stores signals/summary/next queries, marks the job complete
GET  /api/job?id=…&peek=1 → read-only copy of the job (the page uses it while the AI step holds a poll open)
GET  /api/jobs       → recent research list (from the Apify key-value store "index" record)
GET  /api/health     → which keys are configured
```

While a research runs, the page shows a translucent loading screen with a radar sweep, one live row per platform (extracting · 12s → 25 results · 9s) and the AI step; it fades out the moment the job is complete. "Peek at results so far" dismisses it early.

**Focus brief.** Under the search bar there is an optional, paragraph-length "Focus" box. The platforms are always searched for the topic alone; the brief is sent to the AI, which treats results outside that angle as off-topic and builds the signals, summary and next queries around the aspects it names. The brief is stored with the job, shown on the results page, and is part of the reuse key (same topic with a different focus starts a new research).

**Report archive (Supabase).** When the project is connected to a Supabase database (the Vercel ↔ Supabase integration injects `SUPABASE_URL` and `SUPABASE_SECRET_KEY`), every research is saved when it completes: one row per report in `reports` (with the full JSON), one row per result in `report_items`, one per signal in `report_signals`, one per platform run in `report_sources`. Run `db/schema.sql` once in the Supabase SQL editor. The **History** page (`/history`) searches the archive by keyword, focus, signal or summary, filters by date, and exports CSV; `POST /api/backfill` copies whatever the Apify store still holds into the database (idempotent). Without a database the dashboard works exactly as before, it just doesn't archive.

**Cost tracker.** Every research records what it cost, in USD: for each platform run, what the Apify actor charged (pay-per-event counts × price, pay-per-result items × price, or platform usage — read from the run object), and for the AI step, what OpenRouter charged (`usage.include` on the completion, with the generation endpoint as fallback). A report shows its cost in the header and a per-platform breakdown under **Sources**; the **Costs** page has the tracker — total spent, this month, today, average per research, spend per day for the last 30 days and spend by platform — plus a cost column and CSV columns. `POST /api/backfill` fills in the scraper costs of reports made before the tracker existed (their AI cost is unknown and shown as not recorded). Stored in `reports.cost_usd / cost_apify_usd / cost_brain_usd / cost` and one row per platform run in `report_sources`. The **Costs** page (`/costs`, button in the top bar) holds the tracker, a cost log of every research with CSV export, and live **account credits**: Apify usage this billing cycle against the plan limit (`/v2/users/me/limits`) and OpenRouter credits bought / used / left (`/api/v1/credits`), via `GET /api/credits`.

**Links.** Every result links to the original post/video/article on its platform (Google News items go through Google's redirect, which lands on the publisher). If a scraper returns no usable URL, the link falls back to that platform's own search for the result, so nothing is a dead end.

### Sources (topic mode)

| Platform | Actor | Query |
|---|---|---|
| Google News | `data_xplorer/google-news-scraper-fast` | keyword, 1d/7d, region |
| Google Trends | `orbots/google-trends-scraper` (keywords mode) | search-interest curve for the window |
| Reddit | `harshmaur/reddit-scraper` | search, top of day/week |
| YouTube | `streamers/youtube-scraper` | search, most viewed, today/week |
| X | `apidojo/tweet-scraper` | search, Top, English, since window start |
| TikTok | `clockworks/tiktok-scraper` | video search, past 24h/week, region proxy |
| Instagram | `apify/instagram-hashtag-scraper` | keyword search, reels |
| GitHub | `rupom888/github-repository-scraper` | repo search: created in the last 30 days + pushed within the window, most-starred first; ranked by stars per day |

### Sources (trending mode)

Google Trending Now, Google News top stories, Reddit r/popular, YouTube mostPopular chart, X trends by location, TikTok Creative Center hashtags (7d, US/GB only), Pinterest top searches, Instagram trending reels, GitHub repos created this week (most-starred first).

### Scoring

Each result: **reach** (rank inside its platform) + **momentum** (freshness, Google growth %, TikTok direction, Pinterest WoW) + platform weight. Each signal adds **breadth** (+12 per extra platform, +4 for a second region) and a volume bonus, then subtracts 25 for *caution* and 60 for *avoid*.

## Run locally

```bash
npm test                       # unit tests on real row shapes
MOCK=1 npm run dev             # full app on http://localhost:3000 with mocked Apify/OpenRouter (no credits used)
APIFY_TOKEN=… OPENROUTER_API_KEY=… npm run dev   # real run
```

## Limits worth knowing

- Vague topics give vague results; add a brand, product or place.
- TikTok's Creative Center has no India data and a 7-day minimum window; Instagram's trending feed is global.
- X hides post volumes for trends. YouTube's Trending page was retired, so trending mode uses the official mostPopular chart.
- Non-English results are filtered out in this version.
- The AI analysis runs inside `api/job` with a 240 s budget (needs Vercel **Fluid compute**, on by default for new projects; `maxDuration` 300). Actor runs up to 7 min are fine because the page keeps polling.
- Live instance: https://trend-radar-pi-dusky.vercel.app (access code required).

## Roadmap

- **V4:** saved topics with daily scheduled runs and "new since yesterday" diffs; Hindi and regional-language results; client workspaces with per-client shortlists; PDF/Doc trend report export.
- Bring your own scrapers: the source registry in `lib/sources.js` is the only file to touch to add a platform.

## License

MIT. Platform logos © their owners, served from the CC0 Simple Icons set.
