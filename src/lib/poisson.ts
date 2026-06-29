/**
 * Distribuição de Poisson para calcular probabilidade de desarmes.
 *
 * Se um jogador faz em média λ desarmes por jogo, a probabilidade de
 * fazer exatamente k desarmes é: P(X=k) = (λ^k * e^-λ) / k!
 *
 * Para o mercado "2+ desarmes": P(X >= 2) = 1 - P(X=0) - P(X=1)
 */

/** Calcula k! (fatorial) */
function factorial(k: number): number {
  if (k <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= k; i++) result *= i;
  return result;
}

/** P(X = k) para Poisson com média λ */
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Probabilidade de o jogador fazer >= `line` desarmes,
 * dado que a média histórica é `lambda`.
 */
export function probAtLeast(lambda: number, line: number): number {
  if (lambda <= 0) return line <= 0 ? 1 : 0;
  if (line <= 0) return 1;

  // P(X >= line) = 1 - P(X < line) = 1 - Σ P(X=k) para k=0..line-1
  let cumBelow = 0;
  for (let k = 0; k < line; k++) {
    cumBelow += poissonPMF(k, lambda);
  }
  return Math.max(0, Math.min(1, 1 - cumBelow));
}

/**
 * Converte probabilidade em odd justa (decimal).
 * Odd justa = 1 / probabilidade.
 * Ex: prob 50% → odd justa 2.00
 */
export function fairOdds(probability: number): number {
  if (probability <= 0) return 999;
  return 1 / probability;
}

/**
 * Calcula o EV (Expected Value) de uma aposta.
 * EV = (probabilidade * odd) - 1
 * EV > 0 = valor positivo (bom para o apostador)
 * EV < 0 = valor negativo (casa tem vantagem)
 */
export function expectedValue(probability: number, odd: number): number {
  return probability * odd - 1;
}

/**
 * Para cada linha (1+, 2+, 3+, 4+), retorna:
 * - probabilidade de bater a linha
 * - odd justa
 * - EV comparado com a melhor odd disponível
 */
export function computeLineAnalysis(
  average: number,
  lines: string[],
  bestOddsByLine: Record<string, number>,
) {
  return lines.map((lineStr) => {
    const line = parseInt(lineStr.replace('+', ''), 10) || 0;
    const prob = probAtLeast(average, line);
    const fair = fairOdds(prob);
    const bestOdd = bestOddsByLine[lineStr] ?? 0;
    const ev = bestOdd > 0 ? expectedValue(prob, bestOdd) : 0;

    return {
      line: lineStr,
      probability: parseFloat((prob * 100).toFixed(1)),
      fairOdds: parseFloat(fair.toFixed(2)),
      bestOdd: parseFloat(bestOdd.toFixed(2)),
      ev: parseFloat((ev * 100).toFixed(1)),
      hasValue: ev > 0,
    };
  });
}
