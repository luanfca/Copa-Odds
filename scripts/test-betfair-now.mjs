/**
 * Teste direto: roda scrapeBetfair e mostra TODOS os logs do DOM.
 * Usa o código EXATO de produção (scrapeBetfair do betfairAdapter.ts).
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

// Importa a função scrapeBetfair do código de produção
const { scrapeBetfair } = await import('../src/scraping/betfairAdapter.js');

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR'],
});

const sessionDir = path.join(process.cwd(), '.playwright-sessions');
fs.mkdirSync(sessionDir, { recursive: true });
const sessionPath = path.join(sessionDir, 'betfair-session.json');

const contextOptions = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1440, height: 900 },
};

let ctx;
try {
  ctx = fs.existsSync(sessionPath)
    ? await browser.newContext({ ...contextOptions, storageState: sessionPath })
    : await browser.newContext(contextOptions);
} catch {
  ctx = await browser.newContext(contextOptions);
}

console.log('Iniciando scrapeBetfair (Brasileirão)...');
console.time('scrape');

const results = await scrapeBetfair(ctx, ['brasileirao']);

console.timeEnd('scrape');
console.log(`\nResultados: ${results.length} jogos com odds`);

// Mostra jogos e quantidade de odds
for (const m of results) {
  const oddsPorMercado = {};
  for (const o of m.odds) {
    if (!oddsPorMercado[o.market]) oddsPorMercado[o.market] = 0;
    oddsPorMercado[o.market]++;
  }
  const mercadosStr = Object.entries(oddsPorMercado).map(([k, v]) => `${k}:${v}`).join(', ');
  console.log(`  ${m.homeTeam} vs ${m.awayTeam} — ${m.odds.length} odds (${mercadosStr})`);
  
  // Para Internacional vs Cruzeiro, mostra Matheus Pereira
  if (m.homeTeam.includes('Internacional') && m.awayTeam.includes('Cruzeiro')) {
    const matheus = m.odds.filter(o => o.playerName.toLowerCase().includes('matheus'));
    if (matheus.length > 0) {
      console.log('    MATHEUS PEREIRA:');
      for (const o of matheus) {
        console.log(`      ${o.market} ${o.line} = ${o.value}`);
      }
    }
  }
}

// Salva sessão
try { await ctx.storageState({ path: sessionPath }); } catch {}
await ctx.close().catch(() => null);
await browser.close().catch(() => null);

console.log('\nFim do teste');
