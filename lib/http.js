import { HttpError } from "./jobs.js";
export function send(res, status, body) { res.status(status).setHeader("Cache-Control", "no-store"); res.json(body); }
export async function guard(res, fn) {
  try { await fn(); }
  catch (e) {
    const status = e instanceof HttpError ? e.status : e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    send(res, status, { error: String(e.message || e).slice(0, 400) });
  }
}
export function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-apify-token, x-openrouter-key, x-openrouter-model, x-access-code");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}
