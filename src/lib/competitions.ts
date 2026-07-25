/**
 * Configuração de competições suportadas.
 *
 * Cada entrada descreve os IDs usados para cruzar dados entre as fontes
 * de stats de jogador (365scores via lineups365, SofaScore via sofascoreStats
 * e FotMob). As chaves são usadas como `CompetitionKey`.
 */

export type CompetitionKey =
  | 'copa'
  | 'brasileirao'
  | 'serieb'
  | 'mls'
  | 'premier_league'
  | 'la_liga'
  | 'serie_a'
  | 'bundesliga'
  | 'ligue_1'
  | 'champions_league';

export interface CompetitionConfig {
  id: string;
  id365: string;
  idSofaScore?: number;
  name: string;
}

export const COMPETITIONS: Record<string, CompetitionConfig> = {
  copa: { id: 'copa', id365: '1', idSofaScore: 1, name: 'Copa do Mundo' },
  brasileirao: { id: 'brasileirao', id365: '113', idSofaScore: 325, name: 'Brasileirão Série A' },
  serieb: { id: 'serieb', id365: '116', idSofaScore: 390, name: 'Brasileirão Série B' },
  mls: { id: 'mls', id365: '104', idSofaScore: 242, name: 'Major League Soccer' },
  premier_league: { id: 'premier_league', id365: '8', idSofaScore: 17, name: 'Premier League' },
  la_liga: { id: 'la_liga', id365: '15', idSofaScore: 8, name: 'La Liga' },
  serie_a: { id: 'serie_a', id365: '23', idSofaScore: 23, name: 'Serie A' },
  bundesliga: { id: 'bundesliga', id365: '34', idSofaScore: 35, name: 'Bundesliga' },
  ligue_1: { id: 'ligue_1', id365: '29', idSofaScore: 34, name: 'Ligue 1' },
  champions_league: { id: 'champions_league', id365: '16', idSofaScore: 7, name: 'Champions League' },
};
