/**
 * Dados de exemplo (mock) para modo de demonstração.
 * Usados quando USE_MOCK=true ou quando o scraping falha.
 * Baseado em partidas realistas da Copa do Mundo 2026.
 */

export const mockMatches = [
  {
    id: 'mock-match-1',
    dateTime: new Date('2026-06-12T18:00:00-03:00').toISOString(),
    homeTeam: 'Brasil',
    awayTeam: 'Argentina',
    stage: 'Fase de Grupos',
    homeFlag: 'BR',
    awayFlag: 'AR',
  },
  {
    id: 'mock-match-2',
    dateTime: new Date('2026-06-13T15:00:00-03:00').toISOString(),
    homeTeam: 'França',
    awayTeam: 'Alemanha',
    stage: 'Fase de Grupos',
    homeFlag: 'FR',
    awayFlag: 'DE',
  },
  {
    id: 'mock-match-3',
    dateTime: new Date('2026-06-14T12:00:00-03:00').toISOString(),
    homeTeam: 'Espanha',
    awayTeam: 'Portugal',
    stage: 'Fase de Grupos',
    homeFlag: 'ES',
    awayFlag: 'PT',
  },
  {
    id: 'mock-match-4',
    dateTime: new Date('2026-06-15T21:00:00-03:00').toISOString(),
    homeTeam: 'Inglaterra',
    awayTeam: 'Itália',
    stage: 'Oitavas de Final',
    homeFlag: 'GB-ENG',
    awayFlag: 'IT',
  },
];

export const mockOddsData = [
  // Brasil vs Argentina
  {
    matchId: 'mock-match-1',
    players: [
      {
        id: 'p1',
        name: 'casemiro',
        displayName: 'Casemiro',
        team: 'Brasil',
        odds: [
          { house: 'betfair', line: '1+', value: 1.65 },
          { house: 'betmgm', line: '1+', value: 1.70 },
          { house: 'superbet', line: '1+', value: 1.72 },
          { house: 'betfair', line: '2+', value: 2.80 },
          { house: 'betmgm', line: '2+', value: 2.90 },
          { house: 'superbet', line: '2+', value: 2.75 },
        ],
      },
      {
        id: 'p2',
        name: 'bruno guimaraes',
        displayName: 'Bruno Guimarães',
        team: 'Brasil',
        odds: [
          { house: 'betfair', line: '1+', value: 1.80 },
          { house: 'betmgm', line: '1+', value: 1.85 },
          { house: 'superbet', line: '1+', value: 1.75 },
          { house: 'betfair', line: '2+', value: 3.10 },
          { house: 'betmgm', line: '2+', value: 3.20 },
        ],
      },
      {
        id: 'p3',
        name: 'rodrigo de paul',
        displayName: 'Rodrigo De Paul',
        team: 'Argentina',
        odds: [
          { house: 'betfair', line: '1+', value: 1.75 },
          { house: 'betmgm', line: '1+', value: 1.90 },
          { house: 'superbet', line: '1+', value: 1.85 },
          { house: 'betmgm', line: '2+', value: 3.50 },
          { house: 'superbet', line: '2+', value: 3.40 },
        ],
      },
      {
        id: 'p4',
        name: 'alexis mac allister',
        displayName: 'Alexis Mac Allister',
        team: 'Argentina',
        odds: [
          { house: 'betfair', line: '1+', value: 2.10 },
          { house: 'betmgm', line: '1+', value: 2.00 },
          { house: 'superbet', line: '1+', value: 2.20 },
          { house: 'betfair', line: '2+', value: 4.00 },
          { house: 'superbet', line: '2+', value: 3.80 },
        ],
      },
      {
        id: 'p5',
        name: 'gerson',
        displayName: 'Gerson',
        team: 'Brasil',
        odds: [
          { house: 'betfair', line: '1+', value: 2.40 },
          { house: 'betmgm', line: '1+', value: 2.60 },
          { house: 'superbet', line: '1+', value: 2.50 },
        ],
      },
    ],
  },
  // França vs Alemanha
  {
    matchId: 'mock-match-2',
    players: [
      {
        id: 'p6',
        name: 'tchouameni',
        displayName: 'Tchouaméni',
        team: 'França',
        odds: [
          { house: 'betfair', line: '1+', value: 1.60 },
          { house: 'betmgm', line: '1+', value: 1.65 },
          { house: 'superbet', line: '1+', value: 1.62 },
          { house: 'betfair', line: '2+', value: 2.60 },
          { house: 'betmgm', line: '2+', value: 2.70 },
          { house: 'superbet', line: '2+', value: 2.65 },
        ],
      },
      {
        id: 'p7',
        name: 'kimmich',
        displayName: 'Kimmich',
        team: 'Alemanha',
        odds: [
          { house: 'betfair', line: '1+', value: 1.55 },
          { house: 'betmgm', line: '1+', value: 1.58 },
          { house: 'superbet', line: '1+', value: 1.60 },
          { house: 'betfair', line: '2+', value: 2.40 },
          { house: 'betmgm', line: '2+', value: 2.45 },
          { house: 'superbet', line: '2+', value: 2.50 },
        ],
      },
      {
        id: 'p8',
        name: 'camavinga',
        displayName: 'Camavinga',
        team: 'França',
        odds: [
          { house: 'betfair', line: '1+', value: 1.90 },
          { house: 'betmgm', line: '1+', value: 2.00 },
          { house: 'superbet', line: '1+', value: 1.95 },
        ],
      },
    ],
  },
];

export const mockHistoryData = {
  p1: [
    { date: '2026-06-08', betfair: 1.60, betmgm: 1.65, superbet: 1.68 },
    { date: '2026-06-09', betfair: 1.62, betmgm: 1.67, superbet: 1.70 },
    { date: '2026-06-10', betfair: 1.63, betmgm: 1.68, superbet: 1.71 },
    { date: '2026-06-11', betfair: 1.65, betmgm: 1.70, superbet: 1.72 },
    { date: '2026-06-12', betfair: 1.65, betmgm: 1.70, superbet: 1.72 },
  ],
  p2: [
    { date: '2026-06-08', betfair: 1.75, betmgm: 1.80, superbet: 1.72 },
    { date: '2026-06-09', betfair: 1.78, betmgm: 1.82, superbet: 1.74 },
    { date: '2026-06-10', betfair: 1.79, betmgm: 1.84, superbet: 1.74 },
    { date: '2026-06-11', betfair: 1.80, betmgm: 1.85, superbet: 1.75 },
    { date: '2026-06-12', betfair: 1.80, betmgm: 1.85, superbet: 1.75 },
  ],
};
