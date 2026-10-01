import { listReports, archiveStats, dbEnabled } from "../lib/db.js";
import { send, guard, cors } from "../lib/http.js";
export const config = { maxDuration: 30 };
// The report archive (Supabase). Open like the rest of the results: anyone with the link can browse past research.
export default async function handler(req, res) {
  if (cors(req, res)) return;
  await guard(res, async () => {
    if (!dbEnabled()) return send(res, 200, { enabled: false, reports: [], total: 0, stats: null });
    const q = req.query || {};
    const [list, stats] = await Promise.all([listReports({ q: q.q, from: q.from, to: q.to, region: q.region, limit: q.limit, offset: q.offset }), q.stats === "0" ? null : archiveStats()]);
    send(res, 200, { enabled: true, ...list, stats });
  });
}
