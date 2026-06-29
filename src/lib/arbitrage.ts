/**
 * Tipos e utilitários de odds para comparação entre casas.
 * (O cálculo de arbitragem foi removido: o app apenas compara odds dos
 *  mercados de desarmes, faltas cometidas e faltas sofridas entre as casas.)
 */

export type House = 'betfair' | 'betmgm' | 'superbet' | 'pitaco';

export interface OddEntry {
  house: House;
  line: string;
  value: number;
  url?: string;
}

/**
 * Encontra a melhor (maior) odd por linha entre todas as casas.
 * Retorna um mapa linha → { melhor odd, casa }.
 */
export function findBestOdds(odds: OddEntry[]): Map<string, OddEntry> {
  const bestMap = new Map<string, OddEntry>();

  for (const odd of odds) {
    const current = bestMap.get(odd.line);
    if (!current || odd.value > current.value) {
      bestMap.set(odd.line, odd);
    }
  }

  return bestMap;
}

/**
 * Verifica se uma odd bate um critério de alerta.
 */
export function matchesAlert(
  odd: OddEntry,
  alert: { minOdd: number; house?: string | null; line?: string | null }
): boolean {
  if (odd.value < alert.minOdd) return false;
  if (alert.house && odd.house !== alert.house) return false;
  if (alert.line && odd.line !== alert.line) return false;
  return true;
}
