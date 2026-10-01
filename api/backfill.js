import { resolveKeys, backfillArchive } from "../lib/jobs.js";
import { send, guard, cors } from "../lib/http.js";
export const config = { maxDuration: 120 };
// POST: copy every report the Apify store still holds into the database. Safe to run repeatedly (upserts).
export default async function handler(req, res) {
  if (cors(req, res)) return;
  await guard(res, async () => {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const keys = resolveKeys(req.headers);
    send(res, 200, await backfillArchive(keys));
  });
}
