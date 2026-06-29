// Force Next.js recompile 1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockOddsData } from '@/lib/mockData';
import { findBestOdds, type OddEntry } from '@/lib/arbitrage';
import { isLikelyPlayerName } from '@/lib/normalize';
import { getPlayerHistory } from '@/lib/playerStats365';
import { getTeamStatAvg } from '@/lib/fotmobStats';
import { SHARED_HISTORY_CACHE } from '@/lib/sharedCache';

export const dynamic = 'force-dynamic';

const CACHE_VERSION = 'v6-shared-cache-fix';
function hKey(team: string, name: string, market: string) {
  return `${CACHE_VERSION}::${team}::${name}::${market}`;
}

// ─── Cache com eviction automática por TTL ────────────────────────────────────
// BUG CORRIGIDO: o Map anterior crescia indefinidamente (memory leak).
// Agora cada entrada tem timestamp e é apagada quando expirada ou quando
// o cache ultrapassa MAX_CACHE_SIZE entradas (LRU simples por inserção).

const MATCH_TTL         = 60_000; // resposta completa (com histórico)
const MATCH_TTL_PARTIAL = 6_000;  // só odds enquanto o 365scores aquece
const MAX_CACHE_SIZE    = 100;    // no máximo 100 jogos em memória

interface CacheEntry { body: unknown; t: number; full: boolean }
const matchCache = new Map<string, CacheEntry>();

/** Invalida cache de jogos. Chamado após nova coleta. */
export function invalidateMatchCache(): void {
  matchCache.clear();
}

function getCached(key: string): CacheEntry | null {
  const hit = matchCache.get(key);
  if (!hit) return null;
  const ttl = hit.full ? MATCH_TTL : MATCH_TTL_PARTIAL;
  if (Date.now() - hit.t > ttl) {
    matchCache.delete(key); // remove entrada expirada
    return null;
  }
  return hit;
}

function setCached(key: string, entry: CacheEntry): void {
  // Eviction: remove a entrada mais antiga quando ultrapassa o limite
  if (matchCache.size >= MAX_CACHE_SIZE) {
    const oldest = matchCache.keys().next().value;
    if (oldest) matchCache.delete(oldest);
  }
  matchCache.set(key, entry);
}

// ─── Cálculo de médias de time ───────────────────────────────────────────────

interface TeamStat {
  team: string;
  avgMade: number;    // média de desarmes/faltas FEITOS pelo time
  avgSuffered: number; // média de desarmes/faltas SOFRIDOS pelo time
  gamesPlayed: number;
}

/**
 * Calcula médias de time usando dados do FotMob.
 * Retorna na ordem: homeTeam primeiro, awayTeam segundo.
 */
async function computeTeamStats(
  players: PlayerOut[],
  market: string,
  homeTeam: string,
  awayTeam: string,
): Promise<TeamStat[]> {
  const homeAvg = await getTeamStatAvg(homeTeam, market);
  const awayAvg = await getTeamStatAvg(awayTeam, market);

  return [
    { team: homeTeam, avgMade: homeAvg, avgSuffered: 0, gamesPlayed: 0 },
    { team: awayTeam, avgMade: awayAvg, avgSuffered: 0, gamesPlayed: 0 },
  ];
}

// ─── Tipo de saída pública ────────────────────────────────────────────────────

interface PlayerOut {
  id: string;
  // 'name' (slug interno) é omitido intencionalmente da resposta
  displayName: string;
  team: string;
  odds: OddEntry[];
  bestByLine: Record<string, OddEntry>;
  history: unknown;
}

// Next.js 14 App Router: params é Promise<{id: string}>
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const reqUrl = new URL(_request.url);
    const market = reqUrl.searchParams.get('market') ?? 'desarmes';
    const useMock = process.env.USE_MOCK === 'true';

    if (useMock) {
      const matchOdds = mockOddsData.find(o => o.matchId === id);
      if (!matchOdds) {
        return NextResponse.json({ error: 'Jogo não encontrado' }, { status: 404 });
      }

      // Aplica variação conforme o mercado selecionado
      const factor = market === 'faltas_cometidas' ? 1.15 : market === 'faltas_sofridas' ? 0.85 : 1.0;
      const players = matchOdds.players.map(p => {
        const odds: OddEntry[] = p.odds.map(o => ({
          house: o.house as OddEntry['house'],
          line: o.line,
          value: parseFloat((o.value * factor).toFixed(2)),
          url: o.house === 'superbet'
            ? 'https://superbet.bet.br'
            : o.house === 'betmgm'
            ? 'https://www.betmgm.bet.br'
            : 'https://www.betfair.bet.br',
        }));
        return { ...p, bestByLine: Object.fromEntries(findBestOdds(odds)) };
      });

      return NextResponse.json({ players, mock: true });
    }

    // Busca dados reais filtrados pelo mercado selecionado
    const match = await prisma.match.findUnique({ where: { id } });
    const homeTeam = match?.homeTeam ?? '';
    const awayTeam = match?.awayTeam ?? '';

    const players = await prisma.player.findMany({
      where: { matchId: id },
      include: {
        snapshots: {
          where: { market },
          orderBy: { collectedAt: 'desc' },
        },
      },
    });

    if (players.length === 0) {
      return NextResponse.json({ players: [], mock: false });
    }

    /**
     * Fallback de URL por casa.
     * Usado apenas quando a URL não foi armazenada no snapshot.
     */
    const HOUSE_FALLBACK: Readonly<Record<string, string>> = {
      betmgm:   'https://www.betmgm.bet.br',
      superbet: 'https://superbet.bet.br',
      betfair:  'https://www.betfair.bet.br',
      bet365:   'https://www.bet365.bet.br',
    };

    // Processa cada jogador (descarta lixo de total/over-under já salvo no DB)
    const enrichedPlayers = players
      .filter(player => isLikelyPlayerName(player.displayName || player.name))
      .map(player => {
        // Agrupa snapshots: pega o mais recente por casa+linha
        const latestByHouseLine = new Map<string, typeof player.snapshots[0]>();
        for (const snap of player.snapshots) {
          const key = `${snap.house}_${snap.line}`;
          if (!latestByHouseLine.has(key)) {
            latestByHouseLine.set(key, snap);
          }
        }

        const odds: OddEntry[] = Array.from(latestByHouseLine.values()).map(s => ({
          house: s.house as OddEntry['house'],
          line: s.line,
          value: s.value,
          url: s.url ?? HOUSE_FALLBACK[s.house] ?? undefined,
        }));

        if (odds.length === 0) return null;

        // BUG CORRIGIDO: 'name' (slug interno) omitido da resposta pública.
        // BUG CORRIGIDO: tipo explícito PlayerOut em vez de any[].
        return {
          id: player.id,
          displayName: player.displayName,
          team: player.team,
          odds,
          bestByLine: Object.fromEntries(findBestOdds(odds)),
          history: null,
        } as PlayerOut;
      }).filter((p): p is PlayerOut => p !== null);

    // BUG CORRIGIDO: race condition de mutação pós-resposta.
    // Aguardamos o resultado do enrich ANTES de construir o body,
    // limitado a 2500ms. Se não terminar a tempo, history fica null
    // mas o objeto nunca é mutado depois de enviado.
    let full = false;
    try {
      await Promise.race([
        Promise.all(
          enrichedPlayers.map(async (p) => {
            const key = hKey(p.team, p.displayName, market);
            if (SHARED_HISTORY_CACHE.has(key)) {
              p.history = SHARED_HISTORY_CACHE.get(key);
            } else {
              const h = await getPlayerHistory(p.displayName, p.team, market);
              if (h !== null) {
                SHARED_HISTORY_CACHE.set(key, h);
                p.history = h;
              }
            }
          }),
        ).then(() => { full = true; }),
        new Promise<void>((r) => setTimeout(r, 2500)),
      ]);
    } catch { /* histórico é best-effort */ }

    // Snapshot imutável do array para o cache — não será mutado após este ponto.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = { players: enrichedPlayers, mock: false };

    // Calcula médias de time para o mercado selecionado via FotMob
    let teamStats: TeamStat[] = [];
    try {
      teamStats = await computeTeamStats(enrichedPlayers, market, homeTeam, awayTeam);
    } catch (err) {
      console.error('Erro ao buscar stats de time:', err);
    }
    body.teamStats = teamStats;

    return NextResponse.json(body);

  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao buscar odds do jogo', detail: String(error) },
      { status: 500 }
    );
  }
}
