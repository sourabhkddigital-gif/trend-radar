import { resolveKeys, advanceJob } from "../lib/jobs.js";
import { send, guard, cors } from "../lib/http.js";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  if (cors(req, res)) return;
  await guard(res, async () => {
    const keys = resolveKeys(req.headers);
    const id = String(req.query?.id || "").replace(/[^a-z0-9]/gi, "");
    if (!id) return send(res, 400, { error: "id required" });
    const job = await advanceJob(keys, id, { retryBrain: req.query?.retry === "brain" });
    send(res, 200, { job });
  });
}
