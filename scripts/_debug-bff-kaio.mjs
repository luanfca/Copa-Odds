import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const MATCH =
  "https://www.betfair.bet.br/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/internacional-x-cruzeiro/e-35688904?tab=jogador";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=pt-BR"],
});
const sessionPath = path.join(process.cwd(), ".playwright-sessions", "betfair-session.json");
const opts = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  viewport: { width: 1440, height: 900 },
};
const ctx = fs.existsSync(sessionPath)
  ? await browser.newContext({ ...opts, storageState: sessionPath })
  : await browser.newContext(opts);
const page = await ctx.newPage();

const payloads = [];
page.on("response", async (res) => {
  try {
    if (res.status() !== 200) return;
    const u = res.url();
    if (!u.includes("bff-gql") && !u.includes("graphql")) return;
    const txt = await res.text();
    if (!/totalShots|shotsOnTarget|SHOT|Kaio/i.test(txt)) return;
    payloads.push(txt);
  } catch {}
});

await page.goto(MATCH, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => window.scrollBy(0, 900));
  await page.waitForTimeout(200);
}
// click ranges
for (const label of ["1+ até 3+", "4+ a 6+", "1+ e 2+", "3+ e 4+", "Mostrar mais"]) {
  await page.evaluate((want) => {
    for (const el of document.querySelectorAll("button,span,a,div,[role=tab],label,li")) {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (t === want.toLowerCase() || (t.includes(want.toLowerCase()) && t.length < 28)) {
        try { el.click(); } catch {}
      }
    }
  }, label);
  await page.waitForTimeout(1200);
}

console.log("payloads", payloads.length);
// analyze last big payload
const big = payloads.sort((a, b) => b.length - a.length)[0] || "";
fs.writeFileSync("scripts/_bf-big.json", big);
console.log("big len", big.length);

// find Kaio contexts
const re = /.{0,80}Kaio Jorge.{0,200}/gi;
const hits = [...big.matchAll(re)].slice(0, 15).map((m) => m[0].replace(/\s+/g, " "));
console.log("Kaio contexts:", hits.length);
hits.forEach((h, i) => console.log(i, h));

// marketType nearby SHOT
const types = [...new Set([...big.matchAll(/"(?:PLAYER_)?[A-Z0-9_]*(?:SHOT|TOTAL_SHOT)[A-Z0-9_]*"/gi)].map((m) => m[0]))];
console.log("marketTypes", types.slice(0, 50));

// switcher labels
const labels = [...new Set([...big.matchAll(/"translated"\s*:\s*"([^"]*\+[^"]*)"/g)].map((m) => m[1]))];
console.log("translated + labels", labels.slice(0, 40));

// totalShots / shotsOnTarget blocks
for (const key of ["totalShots", "shotsOnTarget", "TOTAL_SHOTS", "SHOTS_ON_TARGET"]) {
  const i = big.indexOf(key);
  if (i >= 0) console.log(key, "at", i, big.slice(i, i + 300).replace(/\s+/g, " "));
}

// try parse JSON and walk for Kaio odds with lines
function walk(obj, path = [], out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, path.concat(i), out));
    return out;
  }
  const name = obj.name || obj.runnerName || obj.selectionName;
  const title = obj.cardGroupTitle?.translated || obj.pebbleCardGroupTitle?.translated || obj.title;
  if (typeof name === "string" && /kaio jorge/i.test(name)) {
    out.push({
      path: path.join("."),
      name,
      marketType: obj.marketType || obj.market?.marketType,
      marketName: obj.market?.name,
      title,
      odds: obj.liveData?.runners || obj.odds || obj.displayOdds,
      runner: {
        decimal: obj.liveData?.runners?.[0]?.odds?.decimal || obj.odds?.decimal || obj.displayOdds?.decimal,
      },
      rawKeys: Object.keys(obj).slice(0, 20),
    });
  }
  // also check runners arrays
  if (Array.isArray(obj.runners)) {
    for (const r of obj.runners) {
      if (r && /kaio jorge/i.test(String(r.name || ""))) {
        const live = (obj.liveData?.runners || []).find(
          (lr) => lr.selectionId === r.selectionId || lr.runnerURN === r.runnerURN,
        );
        out.push({
          path: path.join(".") + ".runner",
          name: r.name,
          marketType: obj.marketType,
          marketName: obj.name,
          marketUrn: obj.urn,
          lineGuess: obj.marketType,
          decimal: live?.odds?.decimal || live?.displayOdds?.decimal,
          title,
        });
      }
    }
  }
  for (const [k, v] of Object.entries(obj)) walk(v, path.concat(k), out);
  return out;
}

let parsed;
try { parsed = JSON.parse(big); } catch (e) { console.log("parse fail", e.message); }
if (parsed) {
  const found = walk(parsed);
  console.log("walk hits", found.length);
  // unique by marketType+decimal
  const uniq = [];
  const seen = new Set();
  for (const f of found) {
    const k = `${f.marketType}|${f.marketName}|${f.decimal}|${f.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(f);
  }
  console.log(JSON.stringify(uniq.slice(0, 40), null, 2));
  fs.writeFileSync("scripts/_bf-kaio-walk.json", JSON.stringify(uniq, null, 2));
}

await browser.close();
