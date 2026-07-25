/**
 * Helpers de filtro/lista de jogos para páginas de ranking
 * (desarmes, faltas, finalização…).
 */

export type MatchLite = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  dateTime: string;
  homeFlag?: string | null;
  awayFlag?: string | null;
};

export type MatchOption = {
  id: string;
  label: string;
  homeTeam: string;
  awayTeam: string;
  dateTime: string;
  sortKey: number;
};

/** Normaliza para busca: minúsculo, sem acento. */
export function normSearch(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** True se a query casa com o time da casa OU visitante. */
export function matchIncludesTeam(
  homeTeam: string,
  awayTeam: string,
  query: string,
): boolean {
  const q = normSearch(query);
  if (!q) return true;
  return (
    normSearch(homeTeam).includes(q) ||
    normSearch(awayTeam).includes(q)
  );
}

/** Formata horário local do jogo (pt-BR). */
export function formatKickoff(dateTime: string): string {
  try {
    const d = new Date(dateTime);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate();

    const time = d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (sameDay) return `Hoje ${time}`;
    if (isTomorrow) return `Amanhã ${time}`;
    const day = d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
    return `${day} ${time}`;
  } catch {
    return '';
  }
}

export function formatMatchLabel(homeTeam: string, awayTeam: string, dateTime: string): string {
  const kick = formatKickoff(dateTime);
  const vs = `${homeTeam} vs ${awayTeam}`;
  return kick ? `${kick} · ${vs}` : vs;
}

/**
 * Monta lista única de jogos a partir dos jogadores do ranking,
 * ordenada por horário de jogo (mais cedo → mais tarde).
 */
export function buildUniqueMatches(
  players: Array<{ matchId: string; match: MatchLite }>,
): MatchOption[] {
  const map = new Map<string, MatchOption>();
  for (const p of players) {
    if (!p.matchId || map.has(p.matchId)) continue;
    const dt = p.match?.dateTime || '';
    const sortKey = Date.parse(dt) || 0;
    map.set(p.matchId, {
      id: p.matchId,
      homeTeam: p.match?.homeTeam || '',
      awayTeam: p.match?.awayTeam || '',
      dateTime: dt,
      sortKey,
      label: formatMatchLabel(
        p.match?.homeTeam || '',
        p.match?.awayTeam || '',
        dt,
      ),
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}

/** Filtra opções de jogo por nome de time (casa ou fora). */
export function filterMatchesByTeam(
  matches: MatchOption[],
  teamQuery: string,
): MatchOption[] {
  const q = normSearch(teamQuery);
  if (!q) return matches;
  return matches.filter((m) => matchIncludesTeam(m.homeTeam, m.awayTeam, q));
}
