import { resolveKeys } from "../lib/jobs.js";
import { accountCredits } from "../lib/credits.js";
import { send, guard, cors } from "../lib/http.js";
export const config = { maxDuration: 15 };
// GET: live credit balances of the Apify and OpenRouter accounts behind this dashboard (used / left), for the cost tracker.
export default async function handler(req, res) {
  if (cors(req, res)) return;
  await guard(res, async () => send(res, 200, await accountCredits(resolveKeys(req.headers))));
}
