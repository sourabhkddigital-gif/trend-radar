import { resolveKeys, createJob } from "../lib/jobs.js";
import { send, guard, cors } from "../lib/http.js";
export const config = { maxDuration: 60 };
const recent = new Map(); // bot guard only: 60 starts per IP per 10 minutes is far beyond what a person can do (each research takes 1–3 min)
function limited(ip) { const now = Date.now(); const arr = (recent.get(ip) || []).filter(t => now - t < 600000); if (arr.length >= 60) return true; arr.push(now); recent.set(ip, arr); return false; }
export default async function handler(req, res) {
  if (cors(req, res)) return;
  await guard(res, async () => {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "local";
    if (!req.headers["x-apify-token"] && limited(ip)) return send(res, 429, { error: "Too many research runs from this connection. Try again in a few minutes, or add your own Apify token in Settings." });
    const keys = resolveKeys(req.headers, { spend: true });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { job, reused } = await createJob(keys, { ...body, ip });
    send(res, reused ? 200 : 201, { job, reused });
  });
}
