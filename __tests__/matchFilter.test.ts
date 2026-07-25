import {
  normSearch,
  matchIncludesTeam,
  buildUniqueMatches,
  filterMatchesByTeam,
  formatMatchLabel,
} from '../src/lib/matchFilter';

describe('normSearch', () => {
  test('remove acentos e lower', () => {
    expect(normSearch('São Paulo')).toBe('sao paulo');
    expect(normSearch('  PALMEIRAS  ')).toBe('palmeiras');
  });
});

describe('matchIncludesTeam', () => {
  test('casa ou fora', () => {
    expect(matchIncludesTeam('Coritiba', 'Palmeiras', 'palmeiras')).toBe(true);
    expect(matchIncludesTeam('Palmeiras', 'Coritiba', 'palmeiras')).toBe(true);
    expect(matchIncludesTeam('Flamengo', 'Vasco', 'palmeiras')).toBe(false);
  });

  test('acentos', () => {
    expect(matchIncludesTeam('São Paulo', 'Athletico-PR', 'sao paulo')).toBe(true);
    expect(matchIncludesTeam('Athletico-PR', 'São Paulo', 'sao')).toBe(true);
  });
});

describe('buildUniqueMatches', () => {
  test('ordena por horário crescente', () => {
    const players = [
      {
        matchId: 'b',
        match: {
          id: 'b',
          homeTeam: 'B',
          awayTeam: 'C',
          dateTime: '2026-07-23T22:00:00.000Z',
        },
      },
      {
        matchId: 'a',
        match: {
          id: 'a',
          homeTeam: 'A',
          awayTeam: 'Z',
          dateTime: '2026-07-22T19:00:00.000Z',
        },
      },
      {
        matchId: 'b-dup',
        match: {
          id: 'b',
          homeTeam: 'B',
          awayTeam: 'C',
          dateTime: '2026-07-23T22:00:00.000Z',
        },
      },
    ];
    // second has same matchId 'b' as first after map - fix test data
    const list = [
      players[0],
      players[1],
      { matchId: 'b', match: players[0].match }, // dup id ignored
    ];
    const m = buildUniqueMatches(list);
    expect(m).toHaveLength(2);
    expect(m[0].id).toBe('a');
    expect(m[1].id).toBe('b');
    expect(m[0].label).toContain('A vs Z');
    expect(m[1].label).toContain('B vs C');
  });
});

describe('filterMatchesByTeam', () => {
  test('filtra visitante', () => {
    const matches = buildUniqueMatches([
      {
        matchId: '1',
        match: {
          id: '1',
          homeTeam: 'Coritiba',
          awayTeam: 'Palmeiras',
          dateTime: '2026-07-22T22:30:00.000Z',
        },
      },
      {
        matchId: '2',
        match: {
          id: '2',
          homeTeam: 'Flamengo',
          awayTeam: 'Vasco',
          dateTime: '2026-07-22T00:30:00.000Z',
        },
      },
    ]);
    const f = filterMatchesByTeam(matches, 'palmeiras');
    expect(f).toHaveLength(1);
    expect(f[0].awayTeam).toBe('Palmeiras');
  });
});

describe('formatMatchLabel', () => {
  test('inclui vs', () => {
    expect(formatMatchLabel('A', 'B', '2026-07-22T22:00:00.000Z')).toContain('A vs B');
  });
});
