/**
 * Debug: Captura payloads JSON da API Betfair para um jogo específico.
 * Mostra TODOS os mercados BFF (GraphQL), runners e odds, focando
 * em comparar faltas_cometidas vs faltas_sofridas.
 *
 * Uso: npx tsx scripts/debug-betfair-api.ts
 */

import { chromium } from 'playwright';
import fs from 'fs';

const BETFAIR_BASE = 'https://www.betfair.bet.br';

// Aceita URL via argumento CLI: npx tsx scripts/debug-betfair-api.ts <event-url>
const cliUrl = process.argv[2];

const MATCHES = cliUrl
  ? [{ name: 'Custom match', url: cliUrl }]
  : [
      { name: 'Atlético Mineiro vs Bahia (Brasileirão)', url: `${BETFAIR_BASE}/apostas/futebol/evento/e-132262155?tab=jogador` },
      { name: 'Internacional vs Cruzeiro (Brasileirão)', url: `${BETFAIR_BASE}/apostas/futebol/evento/e-132262144?tab=jogador` },
    ];

async function main() {
  console.log('=== DEBUG API BETFAIR ===\n');

  const browser = await chromium.launch({
    headless: false, // Navegador visível para evitar detecção anti-bot
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // Verifica se o arquivo de sessão existe
  const statePath = '.state/playwright-state.json';
  const ctxOptions: any = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  };
  if (fs.existsSync(statePath)) {
    ctxOptions.storageState = statePath;
    console.log('✅ Cookies de sessão carregados de', statePath);
  } else {
    console.log('⚠️ Arquivo de sessão não encontrado:', statePath);
    console.log('   O navegador pode exigir login manual.');
    console.log('   Faça login manualmente e feche o navegador.');
    console.log('   Depois execute: npx tsx scripts/save-session.ts');
  }

  const context = await browser.newContext(ctxOptions);

  for (const match of MATCHES) {
    console.log(`\n==========================================================`);
    console.log(`🎯 JOGO: ${match.name}`);
    console.log(`🔗 ${match.url}`);
    console.log(`==========================================================\n`);

    const page = await context.newPage();
    const capturedResponses: Array<{ url: string; data: any; time: number }> = [];

    // Intercepta respostas de API (mesmo padrão do adapter)
    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] ?? '';

      if (
        status === 200 &&
        contentType.includes('application/json') &&
        !url.includes('/exchange/') &&
        (
          url.includes('/api/') ||
          url.includes('/sports/') ||
          url.includes('/betting/') ||
          url.includes('/graphql/') ||
          url.includes('smp.betfair') ||
          url.includes('sib.betfair') ||
          url.includes('apitbd.betfair') ||
          url.includes('sca.betfair')
        )
      ) {
        try {
          const json = await response.json();
          capturedResponses.push({ url, data: json, time: Date.now() });
          console.log(`📡 API capturada: ${url.substring(0, 120)}`);
        } catch {
          // Ignora erros de parse
        }
      }
    });

    // Navega para o jogo
    console.log('Navegando para o jogo...');
    try {
      await page.goto(match.url, { waitUntil: 'load', timeout: 60000 });
    } catch {
      console.log('⚠️ Timeout no load, continuando...');
    }
    console.log('Aguardando carregamento...');
    await page.waitForTimeout(5000);

    // Clica na aba "Jogador" se necessário
    await page.evaluate(() => {
      try {
        const targetKeywords = ['jogador', 'estatísticas', 'faltas', 'desarmes', 'especiais'];
        const allElements = Array.from(document.querySelectorAll('*'));
        const leaves = allElements.filter(el => {
          if (el.children.length > 0) return false;
          const txt = el.textContent?.trim().toLowerCase() || '';
          return targetKeywords.some(kw => txt === kw || (txt.includes(kw) && txt.length < 25));
        });
        if (leaves.length > 0) (leaves[0] as HTMLElement).click();
      } catch (e) { }
    });
    await page.waitForTimeout(2000);

    // Rola a página para carregar mercados lazy-loaded
    console.log('Rolando página...');
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 800);
        const scrollables = Array.from(document.querySelectorAll('div')).filter(el => {
          const style = window.getComputedStyle(el);
          return (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight;
        });
        scrollables.forEach(div => { try { div.scrollBy(0, 800); } catch {} });
      });
      await page.waitForTimeout(300);
    }

    // Clica "Mostrar mais"
    await page.evaluate(() => {
      Array.from(document.querySelectorAll<HTMLElement>('button, span, a'))
        .filter(btn => btn.innerText?.toLowerCase().includes('mostrar mais'))
        .forEach(btn => { try { btn.click(); } catch {} });
    });
    await page.waitForTimeout(2000);

    // Extrai SSR data
    const ssrData = await page.evaluate(() => {
      return (window as any).__TBD_PRELOADED_CATALOG__;
    }).catch(() => null);
    
    if (ssrData) {
      capturedResponses.push({ url: match.url + ' (SSR)', data: ssrData, time: Date.now() });
      console.log('📦 SSR data capturada');
    }

    // ========== ANÁLISE DOS PAYLOADS ==========
    console.log(`\n\n📊 ANALISANDO ${capturedResponses.length} RESPOSTAS DE API...\n`);

    let faltaCardsFound = 0;

    for (const cap of capturedResponses) {
      const { url, data } = cap;
      
      // Tenta extrair cards da resposta
      let cards: any[] = [];
      const items = Array.isArray(data) ? data : [data];
      
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, any>;
        
        if (Array.isArray(obj.data?.Cards)) {
          cards = cards.concat(obj.data.Cards);
        }
        if (Array.isArray(obj.data?.PebbleCardGroup)) {
          cards = cards.concat(obj.data.PebbleCardGroup);
        }
        if (Array.isArray(obj.data?.GenericSwitcherCard)) {
          cards = cards.concat(obj.data.GenericSwitcherCard);
        }
      }

      if (cards.length === 0) continue;

      console.log(`\n📦 RESPOSTA: ${url.substring(0, 100)}`);
      console.log(`   Cards encontrados: ${cards.length}`);

      for (const card of cards) {
        const cardTitle = String(
          card.cardGroupTitle ?? card.pebbleCardGroupTitle?.translated ?? ''
        );
        const cardTitleLower = cardTitle.toLowerCase();

        // Verifica se é um card de jogador (desarmes/faltas/chutes)
        const tackleKeywords = [
          'desarme', 'tackle', 'abordagem', 'desarm',
          'falta', 'foul', 'comete', 'sofre', 'corte', 'cortes',
          'finalização', 'finalizac', 'chute', 'chutes', 'shot', 'shots',
        ];
        const isTackleCard = tackleKeywords.some(kw => cardTitleLower.includes(kw));

        if (!isTackleCard) continue;

        faltaCardsFound++;
        
        console.log(`\n   ┌─ 🏷️ CARD: "${cardTitle}"`);
        
        const edges: any[] = card.full?.edges ?? [];
        console.log(`   │  Edges: ${edges.length}`);

        for (const edge of edges) {
          const markets: any[] = edge?.node?.markets ?? [];
          if (edge?.node?.market) markets.push({ market: edge.node.market });
          
          for (const m of markets) {
            const market: Record<string, any> = m.market ?? {};
            const marketName: string = String(market.name ?? '');
            const marketNameLower = marketName.toLowerCase();

            // Determina o marketKey
            let marketKey = 'desarmes';
            const hasFalta = marketNameLower.includes('falta') || cardTitleLower.includes('falta');
            if (hasFalta) {
              const isSofrida = marketNameLower.includes('sofrida') || cardTitleLower.includes('sofrida') ||
                marketNameLower.includes('sofre') || cardTitleLower.includes('sofre');
              marketKey = isSofrida ? 'faltas_sofridas' : 'faltas_cometidas';
            } else {
              const hasChuteGol = marketNameLower.includes('chute no gol') || marketNameLower.includes('chute ao gol') ||
                marketNameLower.includes('shots on target') || marketNameLower.includes('chutes no gol');
              if (hasChuteGol) marketKey = 'chutes_ao_gol';
              else if (marketNameLower.includes('finalização') || marketNameLower.includes('finalizac') ||
                marketNameLower.includes('chutes') || marketNameLower.includes('shots'))
                marketKey = 'finalizacao';
            }

            const odds = market.liveData?.runners?.map((lr: any) => ({
              selectionId: lr.selectionId,
              odds: lr.odds?.decimal ?? lr.displayOdds?.decimal ?? null,
              display: lr.displayOdds?.decimal ?? lr.odds?.decimal ?? null,
            })) ?? [];

            const runners: any[] = market.runners ?? [];
            
            console.log(`   │  ├─ 📋 Market: "${marketName}"`);
            console.log(`   │  │  → marketKey: ${marketKey}`);
            console.log(`   │  │  → Runners: ${runners.length}`);
            console.log(`   │  │  → liveData.runners: ${odds.length}`);

            // Mostra detalhes dos runners
            for (const r of runners) {
              const playerName: string = String(r.name ?? '');
              const liveRunner = odds.find(
                (o: any) => o.selectionId === r.selectionId
              );
              const oddValue = liveRunner?.odds ?? 0;

              if (oddValue > 1) {
                const line = marketName.match(/(\d+)\+/)?.[0] ?? '?+';
                console.log(`   │  │  ├─ 👤 ${playerName.padEnd(25)} linha=${line} odd=${oddValue}`);
              } else if (playerName) {
                console.log(`   │  │  ├─ 👤 ${playerName.padEnd(25)} (sem odds ao vivo)`);
              }
            }
            
            // Fallback: getMarketPrices
            const marketId = String(market.urn ?? '').split(':').pop();
            if (marketId) {
              console.log(`   │  │  └─ marketId: ${marketId}`);
            }

            // Se for faltas, mostra o RESUMO
            if (marketKey === 'faltas_cometidas' || marketKey === 'faltas_sofridas') {
              console.log(`   │  │`);
              const oddsSummary = runners
                .map((r: any) => {
                  const lr = odds.find((o: any) => o.selectionId === r.selectionId);
                  return { player: r.name, odd: lr?.odds ?? null };
                })
                .filter((r: any) => r.odd > 1);
              if (oddsSummary.length > 0) {
                console.log(`   │  │  📊 AMOSTRA (primeiros 5 com odds):`);
                oddsSummary.slice(0, 5).forEach((r: any) => {
                  const line = marketName.match(/(\d+)\+/)?.[0] ?? '?+';
                  console.log(`   │  │  ├─ ${line} | ${r.player.padEnd(25)} | odd=${r.odd}`);
                });
              }
            }
          }
        }
        console.log(`   └─`);
      }
    }

    if (faltaCardsFound === 0) {
      console.log(`\n⚠️ NENHUM CARD DE FALTAS/DESARMES/CHUTES ENCONTRADO NAS APIs!`);
      console.log(`   Lista de todas as URLs capturadas:`);
      for (const cap of capturedResponses) {
        console.log(`   - ${cap.url.substring(0, 100)}`);
      }

      // Tenta extrair o SSR preloaded data de forma alternativa
      console.log(`\n🔍 Buscando dados no SSR...`);
      const fullSsr = await page.evaluate(() => {
        const keys = Object.keys(window).filter(k => k.includes('TBD') || k.includes('PRELOAD') || k.includes('CATALOG'));
        return keys;
      }).catch(() => []);
      console.log(`   Chaves SSR encontradas: ${fullSsr.join(', ') || 'nenhuma'}`);
    }

    await page.close().catch(() => null);
  }

  console.log(`\n\n✅ DEBUG CONCLUÍDO`);
  await browser.close();
}

main().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
