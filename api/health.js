import { send, cors } from "../lib/http.js";
import { dbEnabled } from "../lib/db.js";
export default async function handler(req, res) {
  if (cors(req, res)) return;
  send(res, 200, { ok: true, server_keys: !!process.env.APIFY_TOKEN, brain: !!(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY), brain_provider: process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENROUTER_API_KEY ? "openrouter" : null, access_code: !!process.env.ACCESS_CODE, database: dbEnabled(), model: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" : process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5", app: process.env.APP_NAME || "Trend Radar" });
}
