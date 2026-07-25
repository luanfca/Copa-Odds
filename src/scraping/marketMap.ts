/**
 * Pure market/line mappers shared by scrapers + unit tests.
 * No Playwright / browser — only string → market+line logic.
 */

export type PlayerMarket =
  | 'desarmes'
  | 'faltas_cometidas'
  | 'faltas_sofridas'
  | 'finalizacao'
  | 'chutes_ao_gol';

/**
 * Betfair marketType → our market + line.
 * Ex: PLAYER_TO_HAVE_2_OR_MORE_SHOTS → finalizacao / 2+
 *     PLAYER_TO_HAVE_1_OR_MORE_SHOTS_ON_TARGET_STAR_SUB → chutes_ao_gol / 1+
 */
export function fromBetfairMarketType(marketType: string): {
  market?: PlayerMarket;
  line?: string;
} {
  if (!marketType) return {};
  const m = marketType.toUpperCase();
  const n = m.match(/(\d+)_OR_MORE/);
  const line = n ? `${parseInt(n[1], 10)}+` : undefined;

  if (m.includes('SHOTS_ON_TARGET') || m.includes('SHOT_ON_TARGET')) {
    return { market: 'chutes_ao_gol', line };
  }
  // Total de chutes / finalização (sem ON_TARGET)
  if (
    m.includes('TOTAL_SHOTS') ||
    (m.includes('TO_HAVE_') && m.includes('SHOTS') && !m.includes('TARGET'))
  ) {
    return { market: 'finalizacao', line };
  }
  if (m.includes('TACKLE')) return { market: 'desarmes', line };
  if (m.includes('FOUL')) {
    if (m.includes('WIN') || m.includes('DRAWN') || m.includes('SUFFER')) {
      return { market: 'faltas_sofridas', line };
    }
    return { market: 'faltas_cometidas', line };
  }
  return line ? { line } : {};
}

/** Resolve market key from Betfair card/market title (PT/EN). */
export function resolveBetfairMarketKey(
  marketNameLower: string,
  cardTitleLower: string,
): string | null {
  if (cardTitleLower.includes('envolvimento') || marketNameLower.includes('envolvimento')) {
    return 'envolvimentos_faltas';
  }

  const hasFalta =
    marketNameLower.includes('falta') ||
    cardTitleLower.includes('falta') ||
    marketNameLower.includes('foul') ||
    cardTitleLower.includes('foul');

  if (hasFalta) {
    const isSofrida =
      marketNameLower.includes('sofrida') ||
      cardTitleLower.includes('sofrida') ||
      marketNameLower.includes('sofre') ||
      cardTitleLower.includes('sofre') ||
      marketNameLower.includes('win fouls') ||
      cardTitleLower.includes('win fouls');
    return isSofrida ? 'faltas_sofridas' : 'faltas_cometidas';
  }

  const hasChuteGol =
    marketNameLower.includes('chute no gol') ||
    cardTitleLower.includes('chute no gol') ||
    marketNameLower.includes('chute ao gol') ||
    cardTitleLower.includes('chute ao gol') ||
    marketNameLower.includes('shots on target') ||
    cardTitleLower.includes('shots on target') ||
    marketNameLower.includes('chutes no gol') ||
    cardTitleLower.includes('chutes no gol') ||
    marketNameLower.includes('finalizações no gol') ||
    cardTitleLower.includes('finalizações no gol') ||
    marketNameLower.includes('finalizacao no gol') ||
    cardTitleLower.includes('finalizacao no gol');
  if (hasChuteGol) return 'chutes_ao_gol';

  // "Chutes por Jogador" = finalização (total de chutes), NÃO chute ao gol
  const hasFinalizacao =
    marketNameLower.includes('chutes por jogador') ||
    cardTitleLower.includes('chutes por jogador') ||
    marketNameLower.includes('finalização') ||
    cardTitleLower.includes('finalização') ||
    marketNameLower.includes('finalizac') ||
    cardTitleLower.includes('finalizac') ||
    marketNameLower.includes('total de chutes') ||
    cardTitleLower.includes('total de chutes') ||
    marketNameLower.includes('player shots') ||
    cardTitleLower.includes('player shots') ||
    (marketNameLower.includes('chutes') && !marketNameLower.includes('gol')) ||
    (cardTitleLower.includes('chutes') && !cardTitleLower.includes('gol')) ||
    (marketNameLower.includes('shots') &&
      !marketNameLower.includes('target') &&
      !marketNameLower.includes('on goal')) ||
    (cardTitleLower.includes('shots') && !cardTitleLower.includes('target'));
  if (hasFinalizacao) return 'finalizacao';

  if (
    marketNameLower.includes('desarme') ||
    cardTitleLower.includes('desarme') ||
    marketNameLower.includes('tackle') ||
    cardTitleLower.includes('tackle')
  ) {
    return 'desarmes';
  }

  return null;
}

/**
 * Over lines (1+/2+/3+) devem ter odds estritamente crescentes:
 * mais chutes = menos provável = odd maior.
 * Rejeita lixo tipo 1+=1.67 2+=2.5 3+=1.67 (BACK/LAY mal mapeado).
 */
export function isStrictlyIncreasingOdds(values: number[]): boolean {
  if (values.length < 2) return true;
  for (let i = 1; i < values.length; i++) {
    if (!(values[i] > values[i - 1] + 1e-9)) return false;
  }
  return true;
}

/**
 * Escolhe N odds de colunas over a partir de tokens brutos do DOM.
 * Tenta: sequencial, BACK/LAY (pares), LAY/BACK — prefere sequência crescente.
 */
export function pickOverColumnOdds(raw: number[], nCols: number): number[] {
  if (nCols <= 0 || raw.length === 0) return [];
  const clean = raw.filter((v) => v > 1 && v < 500);
  if (clean.length === 0) return [];

  const even: number[] = [];
  for (let i = 0; i < clean.length && even.length < nCols; i += 2) even.push(clean[i]);
  const odd: number[] = [];
  for (let i = 1; i < clean.length && odd.length < nCols; i += 2) odd.push(clean[i]);
  const sequential = clean.length >= nCols ? clean.slice(0, nCols) : clean.slice();

  // Preferência: BACK/LAY (pares) quando há ≥ 2× colunas — evita 1+===3+ por intercalação
  const candidates: number[][] = [];
  if (clean.length >= nCols * 2 && even.length === nCols) candidates.push(even);
  if (clean.length >= nCols * 2 && odd.length === nCols) candidates.push(odd);
  if (sequential.length > 0) candidates.push(sequential);
  if (even.length >= 2 && !candidates.includes(even)) candidates.push(even);

  for (const c of candidates) {
    if (c.length >= 2 && isStrictlyIncreasingOdds(c)) return c;
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? [];
}

/**
 * Mapeia odds multi-coluna → linhas.
 * odds[0]→cols[0], odds[1]→cols[1], ...
 * Nunca pula colunas (bug antigo: 1+ e 3+ sem 2+).
 * Se cols for faixa over (ex. 1,2,3) e odds não forem monotônicas, tenta pickOverColumnOdds.
 */
export function mapMultiColumnOdds(
  odds: number[],
  cols: number[],
): Array<{ line: string; value: number }> {
  if (!odds.length || !cols.length) return [];

  let use = odds.slice();
  const isOverRange =
    cols.length >= 2 &&
    cols.every((c, i) => i === 0 || c === cols[i - 1] + 1) &&
    cols[0] >= 1;

  if (isOverRange) {
    const picked = pickOverColumnOdds(odds, cols.length);
    if (picked.length >= 2 && isStrictlyIncreasingOdds(picked)) {
      use = picked;
    } else if (odds.length >= cols.length && isStrictlyIncreasingOdds(odds.slice(0, cols.length))) {
      use = odds.slice(0, cols.length);
    } else if (cols.length >= 3) {
      // Multi-col over sem sequência crescente → lixo (ex. 1+===3+); não emitir
      return [];
    }
  }

  const n = Math.min(use.length, cols.length);
  const out: Array<{ line: string; value: number }> = [];
  for (let i = 0; i < n; i++) {
    const v = use[i];
    if (!(v > 1) || v >= 500) continue;
    out.push({ line: `${cols[i]}+`, value: v });
  }
  return out;
}

/** Pitaco market name (any case/accent) → our market key. */
export function normMarketName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const RAW_PITACO_MARKET_MAP: Record<string, PlayerMarket> = {
  Desarmes: 'desarmes',
  'Faltas Cometidas': 'faltas_cometidas',
  'Faltas Sofridas': 'faltas_sofridas',
  Finalizações: 'finalizacao',
  'Finalizações no Gol': 'chutes_ao_gol',
  'Finalizações totais': 'finalizacao',
  'Chutes no Gol': 'chutes_ao_gol',
  Chutes: 'finalizacao',
};

const NORM_PITACO_MAP = new Map<string, PlayerMarket>();
for (const [key, val] of Object.entries(RAW_PITACO_MARKET_MAP)) {
  NORM_PITACO_MAP.set(normMarketName(key), val);
}

export function resolvePitacoMarket(marketName: string): PlayerMarket | null {
  if (!marketName) return null;
  return NORM_PITACO_MAP.get(normMarketName(marketName)) ?? null;
}

export { RAW_PITACO_MARKET_MAP, NORM_PITACO_MAP };
