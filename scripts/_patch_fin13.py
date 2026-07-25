# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src" / "scraping" / "betfairAdapter.ts"
text = p.read_text(encoding="utf-8")
start = text.index("    const shotsLoaded = await ensureShotsCardsLoaded();")
end = text.index("    // ── Range 4+ a 6+ → Mostrar mais → extrair ──")

new = r'''    // ═══ FINALIZAÇÃO = "Chutes por jogador" ═══
    // Sequência CANÔNICA = scripts/force-betfair-123.mjs (PASS live):
    //   scroll+mostrar-mais → clicar TODAS abas → 1+ até 3+ → Mostrar mais → harvest 1|2|3
    const preferFin = ['chutes por jogador', 'total de chutes', 'finaliz'];
    const avoidFin = ['comete uma falta', 'faltas comet', 'falta sofr', 'cartão', 'marcador'];

    /** Mostrar mais simples (igual force) — clickShowMoreNear às vezes dava showMore=0. */
    async function forceShowMoreSimple(rounds = 8): Promise<number> {
      let total = 0;
      for (let r = 0; r < rounds; r++) {
        const n = await page.evaluate(() => {
          let c = 0;
          for (const el of Array.from(
            document.querySelectorAll<HTMLElement>('button,span,a,div,[role="button"]'),
          )) {
            const t = (el.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (t.includes('mostrar mais') && t.length < 40) {
              try { el.click(); c++; } catch { /* */ }
            }
          }
          return c;
        });
        total += n;
        if (n === 0) break;
        await page.waitForTimeout(600);
      }
      return total;
    }

    // 0) Scroll agressivo + mostrar mais DURANTE o scroll (force)
    for (let i = 0; i < 16; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 900);
        document.querySelectorAll('div').forEach((el) => {
          const s = getComputedStyle(el);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
            try { el.scrollBy(0, 900); } catch { /* */ }
          }
        });
      });
      await page.waitForTimeout(220);
      if (i % 4 === 3) {
        await forceShowMoreSimple(1);
        await page.waitForTimeout(400);
      }
    }

    const shotsLoaded = await ensureShotsCardsLoaded();
    logger.info(`[Betfair] Card "Chutes por jogador" carregado=${shotsLoaded}`);

    // 1) Pré-carga BFF: clicar TODAS as abas de range/coluna
    await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>('button, span, a, div, [role="tab"], label, li'),
      );
      for (let i = 0; i < nodes.length; i++) {
        const t = (nodes[i].innerText || '').trim();
        if (!t || t.length > 28) continue;
        if (
          /^[1-6]\+$/.test(t) ||
          /^[1-6]\+\s*(até|a|e|-)/i.test(t) ||
          /até\s*3|a\s*6|e\s*2|e\s*4/i.test(t)
        ) {
          try { nodes[i].click(); } catch { /* */ }
        }
      }
    });
    await waitForBetfairData(page, 2000);
    await page.waitForTimeout(600);

    // 2) Focus 1+ até 3+
    let r13 = await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+', '1+ - 3+', '1+ até 3', '1+ a 3'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    for (const lab of ['1+ até 3+', '1+ a 3+']) {
      try {
        const loc = page.getByText(lab, { exact: true });
        const nLoc = await loc.count();
        for (let i = 0; i < Math.min(nLoc, 5); i++) {
          await loc.nth(i).click({ force: true, timeout: 500 }).catch(() => null);
        }
      } catch { /* */ }
    }
    const brute13 = await bruteClickLabels(['1+ até 3+', '1+ a 3+', '1+ - 3+']);
    await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+', '1+ - 3+'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    await waitForBetfairData(page, Math.max(TAB_NETWORK_MS, 1600));
    await page.waitForTimeout(1500);

    // 3) Mostrar mais DEPOIS do range
    const showMore13 = await forceShowMoreSimple(8);
    const showMore13b = await clickShowMoreNear(
      ['chutes por jogador', 'total de chutes', 'finaliz', '1+ até 3'],
      4,
    );
    await waitForBetfairData(page, 1000);

    await page.getByText('1+ até 3+', { exact: true }).first().click({ force: true }).catch(() => null);
    await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    await page.waitForTimeout(1000);

    // 4) Harvest multi-col + body
    let added = await harvestShots([1, 2, 3]);
    if (added < 6 || !hasFinLines(['1+', '2+', '3+'])) {
      await forceShowMoreSimple(4);
      await page.getByText('1+ até 3+', { exact: true }).first().click({ force: true }).catch(() => null);
      await waitForBetfairData(page, 1200);
      added += await harvestShots([1, 2, 3]);
    }

    // 5) Backup por coluna se faltar 1+/2+/3+
    if (!hasFinLines(['1+', '2+', '3+'])) {
      for (const col of ['1+', '2+', '3+']) {
        if (hasFinLines([col])) continue;
        await clickRangeInCard(
          ['1+ até 3+', '1+ a 3+'],
          preferFin,
          [...avoidFin, 'chutes no gol'],
        );
        const n = await clickLineNearShots(col);
        await waitForBetfairData(page, Math.max(TAB_NETWORK_MS, 1400));
        added += await harvestShots([1, 2, 3], col);
        logger.info(
          `[Betfair] Finalização ${col} (faltava): lineClicks=${n} +odds=${added} ` +
            `domFin=${JSON.stringify(finLineCounts())}`,
        );
      }
      await clickRangeInCard(
        ['1+ até 3+', '1+ a 3+'],
        preferFin,
        [...avoidFin, 'chutes no gol'],
      );
      added += await harvestShots([1, 2, 3]);
    }

    let api1 = 0;
    let api2 = 0;
    let api3 = 0;
    let api46 = 0;
    try {
      const blob = JSON.stringify(capturedData);
      api1 = (blob.match(/PLAYER_TO_HAVE_1_OR_MORE_SHOTS"/g) || []).length;
      api2 = (blob.match(/PLAYER_TO_HAVE_2_OR_MORE_SHOTS"/g) || []).length;
      api3 = (blob.match(/PLAYER_TO_HAVE_3_OR_MORE_SHOTS"/g) || []).length;
      api46 = (blob.match(/PLAYER_TO_HAVE_[456]_OR_MORE_SHOTS"/g) || []).length;
    } catch { /* */ }
    const finCounts = finLineCounts();
    logger.info(
      `[Betfair] Finalização 1–3: tab=${r13.label} score=${r13.score} clicks=${r13.clicks} ` +
        `brute=${brute13} showMore=${showMore13 + showMore13b} +odds=${added} total=${allDomOdds.length} ` +
        `api1=${api1} api2=${api2} api3=${api3} api4-6=${api46} domFin=${JSON.stringify(finCounts)}`,
    );

'''

p.write_text(text[:start] + new + text[end:], encoding="utf-8")
print("patched", start, "->", end, "new_len", len(new))
