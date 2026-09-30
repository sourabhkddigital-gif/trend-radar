import { resolveKeys, listJobs } from "../lib/jobs.js";
import { send, guard, cors } from "../lib/http.js";
export default async function handler(req, res) {
  if (cors(req, res)) return;
  await guard(res, async () => { const keys = resolveKeys(req.headers); send(res, 200, { jobs: await listJobs(keys), key_source: keys.source }); });
}
