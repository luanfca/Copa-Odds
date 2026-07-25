import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const MATCH =
  "https://www.betfair.bet.br/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/internacional-x-cruzeiro/e-35688904?tab=jogador";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--lang=pt-BR"],
});
const sessionPath = path.join(process.cwd(), ".playwright-sessions", "betfair-session.json");
const opts = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  viewport: { width: 1440, height: 1100 },
};
const ctx = fs.existsSync(sessionPath)
  ? await browser.newContext({ ...opts, storageState: sessionPath })
  : await browser.newContext(opts);
const page = await ctx.newPage();

const shotMarkets = new Map(); // marketType -> {name, kaio, title}

page.on("response", async (res) => {
  try {
    if (res.status() !== 200) return;
    const u = res.url();
    if (!/bff-gql|graphql/i.test(u)) return;
    const txt = await res.text();
    if (!/SHOT|chute|finaliz/i.test(txt)) return;
    // find all marketType SHOT with name
    for (const m of txt.matchAll(/"marketType"\s*:\s*"([^"]*SHOT[^"]*)"/g)) {
      const type = m[1];
      if (!shotMarkets.has(type)) shotMarkets.set(type, { type, samples: 0 });
      shotMarkets.get(type).samples++;
    }
    // titles
    for (const m of txt.matchAll(/"translated"\s*:\s*"([^"]*(?:Chute|Shot|Finaliz)[^"]*)"/gi)) {
      const t = m[1];
      if (![...shotMarkets.values()].some((x) => x.title === t)) {
        // store title
      }
      console.log("TITLE", t);
    }
    // market names
    for (const m of txt.matchAll(/"name"\s*:\s*"([^"]*(?:chute|shot|finaliz)[^"]*)"/gi)) {
      console.log("MNAME", m[1]);
    }
  } catch {}
});

await page.goto(MATCH, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);

// scroll hard like production
for (let i = 0; i < 20; i++) {
  await page.evaluate(() => {
    window.scrollBy(0, 900);
    document.querySelectorAll("div").forEach((el) => {
      const s = getComputedStyle(el);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        try { el.scrollBy(0, 900); } catch {}
      }
    });
  });
  await page.waitForTimeout(250);
  if (i % 5 === 4) {
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll("button,span,a")) {
        if ((btn.innerText || "").toLowerCase().includes("mostrar mais")) {
          try { btn.click(); } catch {}
        }
      }
    });
    await page.waitForTimeout(600);
  }
}

// click every tab-like with + 
await page.evaluate(() => {
  for (const el of document.querySelectorAll("button,span,a,div,[role=tab],label,li")) {
    const t = (el.innerText || "").trim();
    if (/^[1-6]\+|^[1-6]\+ (até|a|e|-) /.test(t) || /até 3|a 6|e 2|e 4/i.test(t)) {
      try { el.click(); } catch {}
    }
  }
});
await page.waitForTimeout(2500);

// more scroll
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(200);
}

console.log("\nSHOT marketTypes seen:");
for (const [k, v] of shotMarkets) console.log(k, v.samples);

// body headings again
const h = await page.evaluate(() => {
  const body = document.body.innerText;
  return {
    hasPor: /chutes por jogador/i.test(body),
    hasGol: /chutes no gol/i.test(body),
    bodyLen: body.length,
    // extract multi-odd rows for Kaio
    kaio: [...body.matchAll(/Kaio Jorge[\s\S]{0,80}/g)].map((m) => m[0].replace(/\s+/g, " ")),
  };
});
console.log(h);

await browser.close();
