import { resolveKeys, advanceJob } from "../lib/jobs.js";
import { send, guard, cors } from "../lib/http.js";
// The AI step runs inside this function; Fluid compute allows up to 300 s on Hobby (800 s on Pro).
export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  if (cors(req, res)) return;
  await guard(res, async () => {
    const retryBrain = req.query?.retry === "brain";
    const keys = resolveKeys(req.headers, { spend: retryBrain }); // viewing is open; re-running the analysis spends credits
    const id = String(req.query?.id || "").replace(/[^a-z0-9]/gi, "");
    if (!id) return send(res, 400, { error: "id required" });
    const job = await advanceJob(keys, id, { retryBrain });
    send(res, 200, { job });
  });
}
