'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Trophy, Star, RefreshCw, BarChart2, ChevronUp, ChevronDown, Minus, Info } from 'lucide-react';
import { formatDateTime, cn, formatOdd, HOUSE_LABELS, HOUSE_COLORS } from '@/lib/utils';
import { Flag } from '@/components/Flag';
import type { OddEntry } from '@/lib/arbitrage';
import { OddHistoryModal } from '@/components/OddHistoryModal';

interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeFlag: string | null;
  awayFlag: string | null;
  dateTime: string;
  stage: string;
  playerCount: number;
}

interface Player {
  id: string;
  name: string;
  displayName: string;
  team: string;
  odds: OddEntry[];
  bestByLine: Record<string, OddEntry>;
}

interface UnifiedRow {
  rowId: string;
  playerId: string;
  displayName: string;
  team: string;
  matchId: string;
  matchLabel: string;
  homeFlag: string | null;
  awayFlag: string | null;
  line: string;
  odds: OddEntry[];
  bestOdd?: OddEntry;
}

const HOUSES: Array<'betfair' | 'betmgm' | 'superbet' | 'pitaco'> = ['betfair', 'betmgm', 'superbet', 'pitaco'];

const LINE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  '1+': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  '2+': { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  '3+': { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
  '4+': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
};

export default function FavoritesPage() {
  const [market, setMarket] = useState<'desarmes' | 'faltas_cometidas' | 'faltas_sofridas'>('desarmes');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [allPlayersData, setAllPlayersData] = useState<Record<string, Player[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortField, setSortField] = useState<'name' | 'match' | 'bestOdd'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedOdd, setSelectedOdd] = useState<{
    playerId: string;
    playerName: string;
    house: string;
    line: string;
  } | null>(null);

  // Load favorites from localStorage
  const loadFavorites = useCallback(() => {
    if (typeof window !== 'undefined') {
      const favs = localStorage.getItem(`favoritos_${market}`);
      if (favs) {
        try {
          setFavorites(JSON.parse(favs));
        } catch (e) {
          console.error('Error parsing favorites', e);
        }
      } else {
        setFavorites([]);
      }
    }
  }, [market]);

  // Fetch all matches and their details concurrently
  const loadData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const matchesRes = await fetch('/api/matches', { cache: 'no-store' });
      if (!matchesRes.ok) throw new Error(`Erro ao buscar jogos: ${matchesRes.status}`);
      const matchesJson = await matchesRes.json();
      const activeMatches: Match[] = matchesJson.matches || [];
      setMatches(activeMatches);

      // Fetch odds details for each match concurrently
      const playersDataMap: Record<string, Player[]> = {};
      await Promise.all(
        activeMatches.map(async (match) => {
          try {
            const oddsRes = await fetch(`/api/matches/${match.id}?market=${market}`, { cache: 'no-store' });
            if (oddsRes.ok) {
              const oddsJson = await oddsRes.json();
              playersDataMap[match.id] = oddsJson.players || [];
            }
          } catch (e) {
            console.error(`Error loading match ${match.id} details`, e);
          }
        })
      );
      setAllPlayersData(playersDataMap);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market]);

  useEffect(() => {
    loadFavorites();
    loadData();
  }, [market, loadFavorites, loadData]);

  // Handle unfavoriting a player directly
  const handleToggleFavorite = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = prev.filter((n) => n !== name);
      localStorage.setItem(`favoritos_${market}`, JSON.stringify(next));
      return next;
    });
  }, [market]);

  // Flatten & Filter rows based on favorited players
  const rows = useMemo(() => {
    const list: UnifiedRow[] = [];

    for (const match of matches) {
      // Ignora jogos que já aconteceram (iniciados há mais de 2 horas)
      const matchDate = new Date(match.dateTime);
      const isPast = matchDate.getTime() + 2 * 60 * 60 * 1000 < Date.now();
      if (isPast) continue;

      const matchPlayers = allPlayersData[match.id] || [];
      const favoritedPlayersInMatch = matchPlayers.filter((p) => favorites.includes(p.displayName));

      for (const p of favoritedPlayersInMatch) {
        // Find distinct lines this player has odds for
        const playerLines = Array.from(new Set(p.odds.map((o) => o.line)));
        for (const line of playerLines) {
          const lineOdds = p.odds.filter((o) => o.line === line);
          const best = p.bestByLine[line];
          list.push({
            rowId: `${match.id}_${p.id}_${line}`,
            playerId: p.id,
            displayName: p.displayName,
            team: p.team,
            matchId: match.id,
            matchLabel: `${match.homeTeam} × ${match.awayTeam}`,
            homeFlag: match.homeFlag,
            awayFlag: match.awayFlag,
            line,
            odds: lineOdds,
            bestOdd: best,
          });
        }
      }
    }

    // Sort rows
    return list.sort((a, b) => {
      let valA: string | number;
      let valB: string | number;

      if (sortField === 'name') {
        valA = a.displayName.toLowerCase();
        valB = b.displayName.toLowerCase();
      } else if (sortField === 'match') {
        valA = a.matchLabel.toLowerCase();
        valB = b.matchLabel.toLowerCase();
      } else {
        valA = a.bestOdd?.value || 0;
        valB = b.bestOdd?.value || 0;
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [matches, allPlayersData, favorites, sortField, sortDir]);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: typeof sortField }) {
    if (sortField !== field) return <Minus className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3 h-3 text-primary" />
    ) : (
      <ChevronDown className="w-3 h-3 text-primary" />
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-4 border-b border-border/20">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold mb-2">
            <Star className="w-3.5 h-3.5 fill-primary" />
            Central de Favoritos
          </div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">
            Jogadores Favoritos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitore em tempo real as odds de {market === 'desarmes' ? 'desarmes' : market === 'faltas_cometidas' ? 'faltas cometidas' : 'faltas sofridas'} dos seus jogadores marcados como favoritos.
          </p>
        </div>

        <button
          onClick={() => loadData(true)}
          disabled={refreshing || loading}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold',
            'border border-border/50 text-muted-foreground bg-muted/10',
            'hover:text-foreground hover:border-primary/45 hover:bg-primary/5',
            'transition-all duration-200 active:scale-[0.98]',
            (refreshing || loading) && 'opacity-50 cursor-not-allowed'
          )}
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          <span>Atualizar Odds</span>
        </button>
      </div>

      {/* Seletor de Mercado Premium */}
      <div className="flex justify-center md:justify-start">
        <div className="inline-flex p-1.5 gap-1 bg-muted/20 backdrop-blur-md rounded-2xl border border-border/20 shadow-inner">
          {[
            { id: 'desarmes', label: 'Desarmes', icon: '🛡️' },
            { id: 'faltas_cometidas', label: 'Faltas Cometidas', icon: '⚠️' },
            { id: 'faltas_sofridas', label: 'Faltas Sofridas', icon: '🤕' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setMarket(item.id as any)}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold tracking-tight transition-all duration-300',
                market === item.id
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-[1.02]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/10'
              )}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-12 w-full rounded-2xl" />
          <div className="skeleton h-48 w-full rounded-2xl" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <p className="text-red-400 font-semibold">{error}</p>
          <button onClick={() => loadData()} className="btn-secondary">
            Tentar novamente
          </button>
        </div>
      ) : favorites.length === 0 ? (
        <div className="odds-table-container flex flex-col items-center justify-center py-20 px-4 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center text-2xl select-none">
            ⭐
          </div>
          <div>
            <h3 className="text-foreground/80 font-bold text-lg">Nenhum jogador favoritado</h3>
            <p className="text-muted-foreground text-sm max-w-md mt-1 mx-auto">
              Navegue até a página de um jogo e clique na estrela ao lado do nome do jogador para adicioná-lo aqui.
            </p>
          </div>
          <Link href="/" className="btn-primary mt-2">
            Ver Jogos Disponíveis
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="odds-table-container flex flex-col items-center justify-center py-20 px-4 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center text-2xl select-none">
            📊
          </div>
          <div>
            <h3 className="text-foreground/80 font-bold text-lg">Nenhuma odd disponível para os favoritos</h3>
            <p className="text-muted-foreground text-sm max-w-md mt-1 mx-auto">
              Os seus {favorites.length} jogadores favoritados não possuem odds ativas no mercado de {market === 'desarmes' ? 'desarmes' : market === 'faltas_cometidas' ? 'faltas cometidas' : 'faltas sofridas'} nas partidas atuais.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="odds-table-container overflow-x-auto">
            <table className="odds-table w-full min-w-[900px]">
              <thead>
                <tr>
                  {/* Estrela & Jogador */}
                  <th
                    className="cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      Jogador <SortIcon field="name" />
                    </div>
                  </th>

                  {/* Jogo */}
                  <th
                    className="cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('match')}
                  >
                    <div className="flex items-center gap-1">
                      Partida <SortIcon field="match" />
                    </div>
                  </th>

                  {/* Linha */}
                  <th className="text-center">Linha</th>

                  {/* Casas */}
                  {HOUSES.map((house) => (
                    <th key={house} className="text-center whitespace-nowrap">
                      <span
                        className="text-[10px] font-extrabold uppercase tracking-wider"
                        style={{ color: HOUSE_COLORS[house] }}
                      >
                        {HOUSE_LABELS[house]}
                      </span>
                    </th>
                  ))}

                  {/* Melhor Odd */}
                  <th
                    className="cursor-pointer hover:text-foreground transition-colors text-right"
                    onClick={() => toggleSort('bestOdd')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Melhor Odd <SortIcon field="bestOdd" />
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, idx) => {
                  const oddMap = new Map<string, number>();
                  for (const o of row.odds) {
                    oddMap.set(o.house, o.value);
                  }

                  const bestOddValue = row.bestOdd?.value || 0;
                  const bestOddHouse = row.bestOdd?.house;
                  const lineStyle = LINE_STYLES[row.line] || {
                    bg: 'bg-muted/40',
                    text: 'text-muted-foreground',
                    border: 'border-border/50',
                  };

                  return (
                    <tr
                      key={row.rowId}
                      className={cn(
                        'fade-in opacity-0',
                        idx < 10 && `stagger-${Math.min(Math.floor(idx / 2) + 1, 5)}`
                      )}
                      style={{ animationFillMode: 'forwards' }}
                    >
                      {/* Jogador */}
                      <td>
                        <div className="flex items-center gap-3 py-0.5">
                          <button
                            onClick={() => handleToggleFavorite(row.displayName)}
                            className="text-yellow-400 hover:text-muted-foreground/50 transition-colors focus:outline-none active:scale-90"
                            title="Remover dos favoritos"
                          >
                            <Star className="w-4.5 h-4.5 fill-yellow-400" />
                          </button>
                          <div>
                            <span className="font-bold text-foreground/90 tracking-tight">
                              {row.displayName}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-medium block">
                              {row.team}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Partida */}
                      <td>
                        <Link
                          href={`/matches/${row.matchId}?market=${market}`}
                          className="group/match flex items-center gap-2 hover:text-primary transition-colors text-xs font-semibold text-muted-foreground"
                        >
                          <span className="inline-flex items-center gap-1 leading-none select-none">
                            <Flag code={row.homeFlag} size={20} />
                            <Flag code={row.awayFlag} size={20} />
                          </span>
                          <span className="group-hover/match:underline">{row.matchLabel}</span>
                        </Link>
                      </td>

                      {/* Linha */}
                      <td className="text-center">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-extrabold border whitespace-nowrap uppercase tracking-wider',
                            lineStyle.bg,
                            lineStyle.text,
                            lineStyle.border
                          )}
                        >
                          {row.line}
                        </span>
                      </td>

                      {/* Casas */}
                      {HOUSES.map((house) => {
                        const val = oddMap.get(house);
                        const isBest = val !== undefined && bestOddHouse === house;

                        return (
                          <td key={house} className="text-center">
                            {val !== undefined ? (
                              <button
                                onClick={() =>
                                  setSelectedOdd({
                                    playerId: row.playerId,
                                    playerName: row.displayName,
                                    house,
                                    line: row.line,
                                  })
                                }
                                className={cn(
                                  'odd-cell group w-[100px] py-1.5 mx-auto active:scale-[0.97]',
                                  isBest ? 'best' : ''
                                )}
                                title="Clique para ver histórico"
                              >
                                <span className="block font-mono font-bold text-sm">
                                  {formatOdd(val)}
                                </span>
                                {isBest && (
                                  <span className="best-badge mt-0.5 inline-flex text-[9px] px-1.5 py-0 leading-none">
                                    ★ melhor
                                  </span>
                                )}
                              </button>
                            ) : (
                              <span className="text-muted-foreground/25 text-xs select-none">
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}

                      {/* Melhor odd */}
                      <td className="text-right">
                        {bestOddValue > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-mono font-black text-primary text-sm tracking-tight">
                              {formatOdd(bestOddValue)}
                            </span>
                            <span
                              className="text-[9px] font-bold uppercase tracking-wider"
                              style={{ color: HOUSE_COLORS[bestOddHouse || ''] }}
                            >
                              {HOUSE_LABELS[bestOddHouse || '']}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/25 select-none">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de histórico */}
      {selectedOdd && (
        <OddHistoryModal
          playerId={selectedOdd.playerId}
          playerName={selectedOdd.playerName}
          house={selectedOdd.house}
          line={selectedOdd.line}
          onClose={() => setSelectedOdd(null)}
        />
      )}
    </div>
  );
}
