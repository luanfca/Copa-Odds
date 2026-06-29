/**
 * Tipos compartilhados de scraping — fonte única da verdade.
 *
 * Antes, cada adapter definia suas próprias interfaces ScrapedOdd/ScrapedMatch
 * localmente com `house` literalmente tipado. Isso gerava triplicação e
 * drift silencioso entre os adapters.
 *
 * Agora todos importam daqui.
 */

/** Casas de apostas suportadas pelo sistema. */
export type BettingHouse = 'betfair' | 'betmgm' | 'superbet' | 'bet365' | 'betsson' | 'pitaco';

/**
 * Odd bruta coletada de uma casa de apostas para um jogador específico.
 * Representa uma única entrada de mercado antes do merge entre casas.
 */
export interface ScrapedOdd {
  /** Nome do jogador como retornado pela casa (pode ter variações ortográficas). */
  playerName: string;
  /** Time do jogador. Pode ser string vazia quando a casa não fornece (ex: Superbet BetBuilder). */
  team: string;
  /** Linha normalizada: '1+', '2+', '3+', '4+'. String vazia indica linha não reconhecida. */
  line: string;
  /** Odd decimal (ex: 1.85). Valores ≤ 1 são descartados. */
  value: number;
  /** Identificador da casa de apostas. */
  house: BettingHouse;
  /**
   * Mercado de aposta:
   * - 'desarmes'        → player to make X+ tackles
   * - 'faltas_cometidas' → player to commit X+ fouls
   * - 'faltas_sofridas'  → player to win X+ fouls
   */
  market: string;
  /** URL direta para a aposta na casa. Opcional — nem todas as respostas de API fornecem. */
  url?: string;
}

/**
 * Jogo com suas odds brutas coletadas, como retornado por cada adapter.
 * O orquestrador (`scraping/index.ts`) agrega e normaliza estes dados
 * antes de persistir no banco.
 */
export interface ScrapedMatch {
  homeTeam: string;
  awayTeam: string;
  dateTime: Date;
  /** Fase do torneio normalizada: 'Fase de Grupos', 'Oitavas de Final', etc. */
  stage: string;
  odds: ScrapedOdd[];
}
