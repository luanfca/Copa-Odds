import os

path = 'src/scraping/betfairAdapter.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the function extractFromBffCard and add debug logging inside the loop
# After the line: const marketKey = resolveBetfairMarketKey(marketNameLower, cardTitle);
# Add logging for falta markets

target = 'const marketKey = resolveBetfairMarketKey(marketNameLower, cardTitle);'
debug_log = '''const marketKey = resolveBetfairMarketKey(marketNameLower, cardTitle);
      
      // DEBUG: dump payload for falta/chute markets
      if (marketKey === 'faltas_cometidas' || marketKey === 'faltas_sofridas' || marketKey === 'finalizacao' || marketKey === 'chutes_ao_gol') {
        const liveOdds = (market.liveData?.runners ?? []).map((lr: any) => ({
          id: lr.selectionId,
          odd: lr.odds?.decimal ?? lr.displayOdds?.decimal ?? null
        }));
        const runnerNames = (market.runners ?? []).map((r: any) => ({ id: r.selectionId, name: r.name }));
        console.log('[DEBUG-BF] ' + marketKey + ' | market="' + marketName + '" | cardTitle="' + cardTitle + '" | runners=' + runnerNames.length + ' | liveOdds=' + liveOdds.length);
        console.log('[DEBUG-BF]   runnerNames:', JSON.stringify(runnerNames.slice(0, 3)));
        console.log('[DEBUG-BF]   liveOdds:', JSON.stringify(liveOdds.slice(0, 3)));
      }'''

count = content.count(target)
if count > 0:
    content = content.replace(target, debug_log, 1)
    print(f'[OK] Added debug logging to extractFromBffCard ({count} occurrences)')
else:
    print(f'[ERROR] Target not found: {target}')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'File size: {os.path.getsize(path)} bytes')
