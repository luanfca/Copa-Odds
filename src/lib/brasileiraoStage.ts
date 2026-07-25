/**
 * Classificação de competições brasileiras.
 *
 * O scrape de várias casas (BetMGM, Betfair, Pitaco, Betsson) marca todos
 * os jogos do Brasil como "Brasileirão Série A", mesmo os da Série B.
 * Para corrigir o `stage` gravado no banco, mantemos a lista de times da
 * Série A e da Série B e classificamos o confronto.
 *
 * Observação: as listas são da temporada 2026. Se times subirem/descerem,
 * basta atualizar os sets abaixo.
 */

const SERIE_A_2026 = new Set<string>([
  'Palmeiras', 'Flamengo', 'Fluminense', 'Athletico Paranaense', 'Athletico-PR',
  'Red Bull Bragantino', 'Bragantino', 'Bahia', 'Coritiba', 'Coritiba SAF',
  'São Paulo', 'Atlético Mineiro', 'Atlético-MG', 'Corinthians', 'Cruzeiro',
  'Botafogo', 'Vitória', 'Vitoria', 'Internacional', 'Santos', 'Grêmio',
  'Gremio', 'Vasco da Gama', 'Vasco', 'Remo', 'Mirassol', 'Chapecoense',
]);

const SERIE_B_2026 = new Set<string>([
  'Ponte Preta', 'Goiás', 'Goias', 'Criciúma', 'Criciuma', 'Vila Nova Go',
  'Vila Nova', 'Operário Pr', 'Operario', 'Athletic Club Mg', 'Athletic-MG',
  'Sport Recife', 'Novorizontino Sp', 'Novorizontino',
  'Botafogo Sp', 'Botafogo-SP', 'Avaí', 'Avai', 'Cuiabá', 'Cuiaba',
  'Londrina', 'São Bernardo', 'Sao Bernardo', 'CRB AL', 'CRB', 'América-mg',
  'América MG', 'America-MG', 'Náutico', 'Nautico', 'Ferroviária',
  'Ferroviaria', 'Paysandu', 'Atlético Go', 'Atlético-GO', 'Atletico-GO',
  'Volta Redonda', 'Amazonas', 'Ceará', 'Ceara', 'Fortaleza', 'Juventude',
]);

/**
 * Normaliza nomes comuns antes de checar o set (remove acentos e espaços
 * extras já tratados em outro lugar, aqui só lower-case defensivo).
 */
function key(name: string): string {
  return name.trim();
}

/**
 * Classifica um confronto do Brasileirão.
 *
 * Regras:
 * - Se ambos os times pertencem à Série A → "Brasileirão Série A".
 * - Se ao menos um time pertence à Série B → "Brasileirão Série B".
 * - Caso contrário (times desconhecidos) → retorna `undefined` para que o
 *   caller mantenha o stage original vindo da casa de apostas.
 */
export function classifyBrasileiraoStage(
  homeTeam: string,
  awayTeam: string,
): 'Brasileirão Série A' | 'Brasileirão Série B' | undefined {
  const home = key(homeTeam);
  const away = key(awayTeam);

  const homeA = SERIE_A_2026.has(home);
  const awayA = SERIE_A_2026.has(away);
  const homeB = SERIE_B_2026.has(home);
  const awayB = SERIE_B_2026.has(away);

  // Se algum time é conhecido da Série B, é Série B (times da B não jogam A).
  if (homeB || awayB) return 'Brasileirão Série B';

  // Se ambos são conhecidos da Série A, é Série A.
  if (homeA && awayA) return 'Brasileirão Série A';

  // Times desconhecidos: não força classificação.
  return undefined;
}
