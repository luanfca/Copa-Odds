/**
 * Detecção de "provável titular" sem fonte externa de escalação.
 *
 * Ideia: as casas de aposta só abrem mercado de jogador (desarmes / faltas)
 * para quem elas esperam que entre em campo e jogue minutos relevantes —
 * tipicamente os titulares. Quem aparece em MAIS casas e MAIS linhas é,
 * com alta probabilidade, titular. Reservas e jogadores improváveis quase
 * nunca recebem mercado próprio de desarmes.
 *
 * Estratégia: para cada (jogo + seleção), pontuamos cada jogador pela
 * cobertura de mercado e marcamos os TOP N como "prováveis titulares".
 *
 * É uma ESTIMATIVA (provável), não a escalação oficial. Para 100% de
 * exatidão seria preciso uma fonte de escalação (arquivo manual ou API).
 */

/** Quantos jogadores por seleção marcamos como prováveis titulares. */
export const PROVAVEL_TITULAR_MAX = 11;

export interface StarterInput {
	playerId: string;
	matchId: string;
	team: string;
	/** Casas (houses) em que o jogador tem odd — repetições são deduplicadas. */
	houses: Iterable<string>;
	/** Linhas em que o jogador tem odd — repetições são deduplicadas. */
	lines: Iterable<string>;
	/** Total de snapshots de odd do jogador (desempate fino). */
	snapshotCount: number;
}

/**
 * Calcula o score de cobertura de um jogador.
 * Peso forte para nº de casas distintas (sinal mais confiável de titular),
 * peso médio para nº de linhas, e o total de snapshots como desempate.
 */
function coverageScore(input: StarterInput): number {
	const distinctHouses = new Set(input.houses).size;
	const distinctLines = new Set(input.lines).size;
	return distinctHouses * 1000 + distinctLines * 10 + input.snapshotCount;
}

/**
 * Recebe todos os jogadores (de todos os jogos) e devolve o conjunto de IDs
 * que são prováveis titulares — os TOP {@link PROVAVEL_TITULAR_MAX} por
 * cobertura dentro de cada (jogo + seleção).
 */
export function computeProbableStarterIds(
	players: ReadonlyArray<StarterInput>,
	maxPerTeam: number = PROVAVEL_TITULAR_MAX,
): Set<string> {
	const groups = new Map<string, Array<{ id: string; score: number }>>();

	for (const p of players) {
		const key = `${p.matchId}::${p.team.trim().toLowerCase()}`;
		const arr = groups.get(key) ?? [];
		arr.push({ id: p.playerId, score: coverageScore(p) });
		groups.set(key, arr);
	}

	const starters = new Set<string>();
	for (const arr of Array.from(groups.values())) {
		arr.sort((a, b) => b.score - a.score);
		for (const { id } of arr.slice(0, maxPerTeam)) {
			starters.add(id);
		}
	}
	return starters;
}
