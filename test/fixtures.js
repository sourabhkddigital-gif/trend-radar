import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("./fixtures/rows.json", import.meta.url), "utf8");
/** Replace __NOW-3h__ style placeholders with real timestamps relative to now. */
export function fixtures() {
  const now = Date.now();
  const text = raw.replace(/"__NOW-(\d+)h(-unix)?__"/g, (_, h, unix) => {
    const t = now - Number(h) * 3600000;
    return unix ? String(Math.floor(t / 1000)) : `"${new Date(t).toISOString()}"`;
  });
  return JSON.parse(text);
}
