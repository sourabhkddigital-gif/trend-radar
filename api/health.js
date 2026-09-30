import { send, cors } from "../lib/http.js";
export default async function handler(req, res) {
  if (cors(req, res)) return;
  send(res, 200, { ok: true, server_keys: !!process.env.APIFY_TOKEN, brain: !!process.env.OPENROUTER_API_KEY, access_code: !!process.env.ACCESS_CODE, model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5", app: process.env.APP_NAME || "Trend Radar" });
}
