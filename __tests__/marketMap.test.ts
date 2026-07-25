/**
 * Unit tests for shipped market/line mappers (Betfair + Pitaco).
 * Exercises real functions from src/scraping/marketMap.ts — no re-implementation.
 */
import {
  fromBetfairMarketType,
  resolveBetfairMarketKey,
  mapMultiColumnOdds,
  resolvePitacoMarket,
  normMarketName,
} from '../src/scraping/marketMap';
import { isLikelyPlayerName, normalizeLine } from '../src/lib/normalize';

describe('fromBetfairMarketType', () => {
  test('total shots (finalização) 1+/2+/3+ without ON_TARGET', () => {
    expect(fromBetfairMarketType('PLAYER_TO_HAVE_1_OR_MORE_SHOTS')).toEqual({
      market: 'finalizacao',
      line: '1+',
    });
    expect(fromBetfairMarketType('PLAYER_TO_HAVE_2_OR_MORE_SHOTS')).toEqual({
      market: 'finalizacao',
      line: '2+',
    });
    expect(fromBetfairMarketType('PLAYER_TO_HAVE_3_OR_MORE_SHOTS')).toEqual({
      market: 'finalizacao',
      line: '3+',
    });
    expect(fromBetfairMarketType('PLAYER_TO_HAVE_4_OR_MORE_SHOTS')).toEqual({
      market: 'finalizacao',
      line: '4+',
    });
  });

  test('shots on target → chutes_ao_gol not finalizacao', () => {
    expect(
      fromBetfairMarketType('PLAYER_TO_HAVE_1_OR_MORE_SHOTS_ON_TARGET_STAR_SUB'),
    ).toEqual({ market: 'chutes_ao_gol', line: '1+' });
    expect(
      fromBetfairMarketType('PLAYER_TO_HAVE_2_OR_MORE_SHOTS_ON_TARGET_STAR_SUB'),
    ).toEqual({ market: 'chutes_ao_gol', line: '2+' });
    expect(
      fromBetfairMarketType('PLAYER_TO_HAVE_3_OR_MORE_SHOTS_ON_TARGET'),
    ).toEqual({ market: 'chutes_ao_gol', line: '3+' });
  });

  test('fouls and tackles', () => {
    expect(fromBetfairMarketType('PLAYER_TO_COMMIT_2_OR_MORE_FOULS_STAR_SUB')).toEqual({
      market: 'faltas_cometidas',
      line: '2+',
    });
    expect(fromBetfairMarketType('PLAYER_TO_HAVE_1_OR_MORE_TACKLES')).toEqual({
      market: 'desarmes',
      line: '1+',
    });
  });
});

describe('resolveBetfairMarketKey', () => {
  test('Chutes por jogador → finalizacao', () => {
    expect(resolveBetfairMarketKey('', 'chutes por jogador')).toBe('finalizacao');
    expect(resolveBetfairMarketKey('jogador tem 2 ou mais chutes', 'chutes por jogador')).toBe(
      'finalizacao',
    );
  });

  test('Chutes no gol → chutes_ao_gol', () => {
    expect(resolveBetfairMarketKey('', 'chutes no gol do jogador')).toBe('chutes_ao_gol');
    expect(resolveBetfairMarketKey('jogador dá 1 ou mais chutes no gol', '')).toBe(
      'chutes_ao_gol',
    );
  });

  test('does not mix SOT into finalizacao', () => {
    const k = resolveBetfairMarketKey(
      'jogador dá 2 ou mais chutes no gol',
      'chutes no gol do jogador',
    );
    expect(k).toBe('chutes_ao_gol');
    expect(k).not.toBe('finalizacao');
  });
});

describe('mapMultiColumnOdds', () => {
  test('maps Kaio-style 1+/2+/3+ without skipping middle column', () => {
    const mapped = mapMultiColumnOdds([1.04, 1.14, 1.53], [1, 2, 3]);
    expect(mapped).toEqual([
      { line: '1+', value: 1.04 },
      { line: '2+', value: 1.14 },
      { line: '3+', value: 1.53 },
    ]);
  });

  test('maps 4+/5+/6+', () => {
    const mapped = mapMultiColumnOdds([2.4, 4, 7], [4, 5, 6]);
    expect(mapped.map((m) => m.line)).toEqual(['4+', '5+', '6+']);
  });

  test('does not invent extra lines when fewer odds than cols', () => {
    const mapped = mapMultiColumnOdds([1.33, 2.5], [1, 2, 3]);
    expect(mapped).toEqual([
      { line: '1+', value: 1.33 },
      { line: '2+', value: 2.5 },
    ]);
  });

  test('rejects non-monotonic 1+/2+/3+ junk (1+===3+)', () => {
    expect(mapMultiColumnOdds([1.67, 2.5, 1.67], [1, 2, 3])).toEqual([]);
  });

  test('picks BACK columns from BACK/LAY pairs', () => {
    const mapped = mapMultiColumnOdds([1.04, 1.08, 1.14, 1.2, 1.53, 1.6], [1, 2, 3]);
    expect(mapped).toEqual([
      { line: '1+', value: 1.04 },
      { line: '2+', value: 1.14 },
      { line: '3+', value: 1.53 },
    ]);
  });

  test('SOT cols [3,4] must not silently remap finalizacao 4+/5+/6+ grid', () => {
    // Bug real: harvest SOT com cols [3,4] sobre grade finalização 4+/5+/6+
    // mapeava 4val→3+ e 5val→4+, deixando 3+===old4+ quando só 1 odd entrava.
    const from456Grid = mapMultiColumnOdds([3.4, 6, 13], [3, 4]);
    // Com cols erradas o mapper ainda emite — por isso harvest DEVE filtrar por mercado.
    // Este teste documenta o comportamento perigoso que o onlyMarket evita.
    expect(from456Grid).toEqual([
      { line: '3+', value: 3.4 },
      { line: '4+', value: 6 },
    ]);
    // O mapeamento correto da grade 4–6:
    expect(mapMultiColumnOdds([3.4, 6, 13], [4, 5, 6])).toEqual([
      { line: '4+', value: 3.4 },
      { line: '5+', value: 6 },
      { line: '6+', value: 13 },
    ]);
  });
});

describe('resolvePitacoMarket', () => {
  test('Finalizações → finalizacao', () => {
    expect(resolvePitacoMarket('Finalizações')).toBe('finalizacao');
    expect(resolvePitacoMarket('finalizacoes')).toBe('finalizacao');
    expect(resolvePitacoMarket('Finalizações totais')).toBe('finalizacao');
    expect(resolvePitacoMarket('Chutes')).toBe('finalizacao');
  });

  test('Chutes no Gol → chutes_ao_gol', () => {
    expect(resolvePitacoMarket('Chutes no Gol')).toBe('chutes_ao_gol');
    expect(resolvePitacoMarket('Finalizações no Gol')).toBe('chutes_ao_gol');
    expect(resolvePitacoMarket('chutes no gol')).toBe('chutes_ao_gol');
  });

  test('desarmes e faltas', () => {
    expect(resolvePitacoMarket('Desarmes')).toBe('desarmes');
    expect(resolvePitacoMarket('Faltas Cometidas')).toBe('faltas_cometidas');
    expect(resolvePitacoMarket('Faltas Sofridas')).toBe('faltas_sofridas');
  });

  test('unknown returns null', () => {
    expect(resolvePitacoMarket('Escanteios')).toBeNull();
    expect(resolvePitacoMarket('')).toBeNull();
  });
});

describe('normMarketName + normalizeLine integration', () => {
  test('norm strips accents for pitaco keys', () => {
    expect(normMarketName('Finalizações')).toBe('finalizacoes');
  });

  test('normalizeLine on Betfair-style labels', () => {
    expect(normalizeLine('1 ou mais')).toBe('1+');
    expect(normalizeLine('2 ou mais Chutes')).toBe('2+');
    expect(normalizeLine('Jogador tem 3 ou mais Chutes')).toBe('3+');
  });
});

describe('isLikelyPlayerName (filter team junk in Betfair DOM)', () => {
  test('accepts player names', () => {
    expect(isLikelyPlayerName('Kaio Jorge')).toBe(true);
    expect(isLikelyPlayerName('Mateo Cassierra')).toBe(true);
  });

  test('rejects team names used as fake players', () => {
    expect(isLikelyPlayerName('Bahia')).toBe(false);
    expect(isLikelyPlayerName('Internacional')).toBe(false);
    expect(isLikelyPlayerName('Flamengo')).toBe(false);
  });

  test('rejects Equipe A/B and generic team labels', () => {
    expect(isLikelyPlayerName('Equipe B')).toBe(false);
    expect(isLikelyPlayerName('Equipe A')).toBe(false);
    expect(isLikelyPlayerName('Time da Casa')).toBe(false);
    expect(isLikelyPlayerName('Team A')).toBe(false);
  });
});
