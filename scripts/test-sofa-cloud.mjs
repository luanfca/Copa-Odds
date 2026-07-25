import { chromium } from 'playwright';

const targets = [
  'https://www.sofascore.com/api/v1/player/1160554/events/last/0',
  'https://api.sofascore.com/api/v1/player/1160554/events/last/0',
];

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});

let ok = false;
try {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  const page = await context.newPage();

  // Alguns PoPs liberam a API depois que o navegador recebe os cookies da home.
  const home = await page.goto('https://www.sofascore.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  }).catch(() => null);
  console.log(`home=${home?.status() ?? 'error'}`);

  for (const target of targets) {
    const response = await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    }).catch(() => null);
    const status = response?.status() ?? 0;
    const body = await page.locator('body').innerText().catch(() => '');
    console.log(`${target} status=${status} bytes=${body.length}`);
    if (status === 200 && body.includes('"events"')) ok = true;
  }
} finally {
  await browser.close();
}

if (!ok) process.exitCode = 1;
