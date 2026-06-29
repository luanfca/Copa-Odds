'use client';

import { useState, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Minus, BarChart2,
  ChevronDown, ChevronUp, Star,
} from 'lucide-react';
import { cn, formatOdd, HOUSE_LABELS, HOUSE_COLORS } from '@/lib/utils';
import { type OddEntry } from '@/lib/arbitrage';
import { OddHistoryModal } from './OddHistoryModal';
import { PlayerAvatar } from './PlayerAvatar';

interface HistoryStat {
  entries: { date: string; opponent: string; value: number; minutes: number | null }[];
  total: number;
  average: number;
}

interface Player {
  id: string;
  displayName: string;
  team: string;
  odds: OddEntry[];
  bestByLine: Record<string, OddEntry>;
  history?: HistoryStat | null;
}

interface OddsTableProps {
  players: Player[];
  matchId: string;
  searchQuery?: string;
  filterHouse?: string;
  favorites: string[];
  onToggleFavorite: (name: string) => void;
  market?: string;
}

interface PlayerLineRow {
  rowId: string;
  playerId: string;
  displayName: string;
  team: string;
  line: string;
  odds: OddEntry[];
  bestOdd?: OddEntry;
  history?: HistoryStat | null;
}

const HOUSES: Array<'betfair' | 'betmgm' | 'superbet' | 'pitaco'> = ['betfair', 'betmgm', 'superbet', 'pitaco'];
const LINES = ['1+', '2+', '3+', '4+'];

const LINE_COLORS: Record<string, string> = {
  '1+': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  '2+': 'text-sky-400 bg-sky-500/10 border-sky-500/25',
  '3+': 'text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
  '4+': 'text-amber-400 bg-amber-500/10 border-amber-500/25',
};

export function OddsTable({
  players,
  matchId,
  searchQuery = '',
  filterHouse,
  favorites,
  onToggleFavorite,
  market = 'desarmes',
}: OddsTableProps) {
  const [selectedLine, setSelectedLine] = useState<string>('Todas');
  const marketSuffix = market === 'desarmes' ? 'Desarmes' : 'Faltas';
  const [sortField, setSortField] = useState<'name' | 'team' | 'bestOdd'>('bestOdd');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedOdd, setSelectedOdd] = useState<{
    playerId: string;
    playerName: string;
    house: string;
    line: string;
  } | null>(null);

  const activeLinesSet = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) {
      for (const o of p.odds) set.add(o.line);
    }
    return set;
  }, [players]);

  const activeLines = LINES.filter(l => activeLinesSet.has(l));
  const tabs = ['Todas', ...activeLines];
  const currentLine = selectedLine || 'Todas';

  const allRows = useMemo(() => {
    const list: PlayerLineRow[] = [];
    for (const p of players) {
      const playerLines = Array.from(new Set(p.odds.map(o => o.line)));
      for (const line of playerLines) {
        const lineOdds = p.odds.filter(o => o.line === line);
        const best = p.bestByLine[line];
        list.push({
          rowId: `${p.id}_${line}`,
          playerId: p.id,
          displayName: p.displayName,
          team: p.team,
          line,
          odds: lineOdds,
          bestOdd: best,
          history: p.history,
        });
      }
    }
    return list;
  }, [players]);

  const filtered = useMemo(() => {
    let list = allRows;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        r =>
          r.displayName.toLowerCase().includes(q) ||
          r.team.toLowerCase().includes(q)
      );
    }

    if (currentLine !== 'Todas') {
      list = list.filter(r => r.line === currentLine);
    }

    if (filterHouse) {
      list = list.filter(r => r.odds.some(o => o.house === filterHouse));
    }

    return [...list].sort((a, b) => {
      const favA = favorites.includes(a.displayName);
      const favB = favorites.includes(b.displayName);
      if (favA && !favB) return -1;
      if (!favA && favB) return 1;

      let valA: string | number;
      let valB: string | number;

      if (sortField === 'name') {
        valA = a.displayName.toLowerCase();
        valB = b.displayName.toLowerCase();
      } else if (sortField === 'team') {
        valA = a.team.toLowerCase();
        valB = b.team.toLowerCase();
      } else {
        valA = a.bestOdd?.value || 0;
        valB = b.bestOdd?.value || 0;
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [allRows, searchQuery, currentLine, filterHouse, favorites, sortField, sortDir]);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: typeof sortField }) {
    if (sortField !== field) return <Minus className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-primary" />
      : <ChevronDown className="w-3 h-3 text-primary" />;
  }

  if (filtered.length === 0) {
    return (
      <div className="space-y-4">
        {activeLines.length > 0 && (
          <LineTabs
            tabs={tabs}
            currentLine={currentLine}
            marketSuffix={marketSuffix}
            onSelect={setSelectedLine}
          />
        )}
        <div className="odds-table-container flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center">
            <BarChart2 className="w-7 h-7 text-muted-foreground/30" />
          </div>
          <div className="text-center">
            <p className="text-foreground/85 font-extrabold text-base">Nenhum jogador encontrado</p>
            <p className="text-muted-foreground text-xs mt-1">
              {searchQuery ? `Sem resultados para "${searchQuery}"` : 'Tente ajustar os filtros do painel'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs de linha */}
      {activeLines.length > 0 && (
        <LineTabs
          tabs={tabs}
          currentLine={currentLine}
          marketSuffix={marketSuffix}
          onSelect={setSelectedLine}
        />
      )}

      {/* Header com colunas — desktop only */}
      <div className="hidden lg:grid lg:grid-cols-[280px_80px_1fr_100px] gap-3 px-4 items-center">
        <button
          onClick={() => toggleSort('name')}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          Jogador <SortIcon field="name" />
        </button>
        <button
          onClick={() => toggleSort('team')}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          Time <SortIcon field="team" />
        </button>
        <div className="grid grid-cols-4 gap-2">
          {HOUSES.map(h => (
            <div key={h} className="text-center">
              <span
                className="text-[9px] font-black uppercase tracking-widest"
                style={{ color: HOUSE_COLORS[h] }}
              >
                {HOUSE_LABELS[h]}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={() => toggleSort('bestOdd')}
          className="flex items-center justify-end gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          Melhor <SortIcon field="bestOdd" />
        </button>
      </div>

      {/* Cards de jogadores */}
      <div className="space-y-2">
        {filtered.map((row, idx) => (
          <PlayerCard
            key={row.rowId}
            row={row}
            index={idx}
            matchId={matchId}
            isFavorite={favorites.includes(row.displayName)}
            onToggleFavorite={() => onToggleFavorite(row.displayName)}
            onOddClick={(house, line) =>
              setSelectedOdd({
                playerId: row.playerId,
                playerName: row.displayName,
                house,
                line,
              })
            }
          />
        ))}
      </div>

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

// ── Tabs de Linha ─────────────────────────────────────────────────────
function LineTabs({
  tabs,
  currentLine,
  marketSuffix,
  onSelect,
}: {
  tabs: string[];
  currentLine: string;
  marketSuffix: string;
  onSelect: (line: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-white/[0.02] border border-white/5 max-w-lg backdrop-blur-md">
      {tabs.map(line => (
        <button
          key={line}
          onClick={() => onSelect(line)}
          className={cn(
            "flex-1 text-center py-2 px-3 text-[11px] font-bold rounded-lg transition-all duration-200 whitespace-nowrap",
            currentLine === line
              ? "bg-primary text-primary-foreground shadow-md shadow-primary/10"
              : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]"
          )}
        >
          {line === 'Todas' ? 'Todas' : `${line} ${marketSuffix}`}
        </button>
      ))}
    </div>
  );
}

// ── Card de Jogador ───────────────────────────────────────────────────
interface PlayerCardProps {
  row: PlayerLineRow;
  index: number;
  matchId?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOddClick: (house: string, line: string) => void;
}

function PlayerCard({ row, index, matchId, isFavorite, onToggleFavorite, onOddClick }: PlayerCardProps) {
  const oddMap = useMemo(() => {
    const map = new Map<string, OddEntry>();
    for (const o of row.odds) {
      map.set(o.house, o);
    }
    return map;
  }, [row.odds]);

  const bestOddValue = row.bestOdd?.value || 0;
  const bestOddHouse = row.bestOdd?.house;
  const lineColor = LINE_COLORS[row.line] || 'text-muted-foreground bg-muted/40 border-border/50';

  return (
    <div
      className={cn(
        'odds-table-container rounded-2xl p-3 sm:p-4 fade-in opacity-0',
        index < 8 && `stagger-${Math.min(index + 1, 5)}`
      )}
      style={{ animationFillMode: 'forwards' }}
    >
      <div className="flex flex-col lg:grid lg:grid-cols-[280px_80px_1fr_100px] gap-3 lg:gap-3 items-start lg:items-center">

        {/* Jogador + Favorito */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggleFavorite}
            className={cn(
              "focus:outline-none transition-all duration-200 active:scale-90 flex-shrink-0",
              isFavorite ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/25 hover:text-muted-foreground/50"
            )}
          >
            <Star className={cn("w-4 h-4", isFavorite && "fill-amber-400")} />
          </button>
          <PlayerAvatar name={row.displayName} team={row.team} matchId={matchId} size={34} />
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-foreground/90 text-sm truncate">{row.displayName}</span>
            {row.history && row.history.entries.length > 0 && (
              <MiniHistory entries={row.history.entries} line={row.line} average={row.history.average} />
            )}
          </div>
        </div>

        {/* Time */}
        <div className="hidden lg:block">
          <span className="text-muted-foreground/60 font-medium text-xs">{row.team || '—'}</span>
        </div>

        {/* Odds Grid — 4 casas */}
        <div className="grid grid-cols-4 gap-2 w-full lg:w-auto">
          {HOUSES.map(house => {
            const oddEntry = oddMap.get(house);
            const value = oddEntry?.value;
            const isBest = value !== undefined && bestOddHouse === house;

            return (
              <div key={house} className="flex flex-col items-center gap-1">
                {/* Label da casa — mobile only */}
                <span
                  className="lg:hidden text-[8px] font-black uppercase tracking-widest"
                  style={{ color: HOUSE_COLORS[house] }}
                >
                  {HOUSE_LABELS[house]}
                </span>

                {oddEntry !== undefined && value !== undefined ? (
                  <OddChip
                    value={value}
                    house={house}
                    isBest={isBest}
                    url={oddEntry.url}
                    onHistoryClick={() => onOddClick(house, row.line)}
                  />
                ) : (
                  <div className="w-full h-[42px] rounded-lg border border-dashed border-white/5 flex items-center justify-center">
                    <span className="text-muted-foreground/15 text-[10px]">—</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Melhor Odd */}
        <div className="flex items-center justify-end gap-2 lg:pl-2">
          {bestOddValue > 0 ? (
            <div className="flex flex-col items-end">
              <span className="font-mono font-black text-primary text-base tracking-tight">
                {formatOdd(bestOddValue)}
              </span>
              <span
                className="text-[9px] font-black uppercase tracking-widest"
                style={{ color: HOUSE_COLORS[bestOddHouse || ''] }}
              >
                {HOUSE_LABELS[bestOddHouse || '']}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground/15 text-xs">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mini History (sparkline inline) ──────────────────────────────────
function MiniHistory({
  entries,
  line,
  average,
}: {
  entries: { date: string; opponent: string; value: number; minutes: number | null }[];
  line: string;
  average: number;
}) {
  const tgt = parseFloat(line.replace(/[^0-9.]/g, '')) || 0;

  return (
    <div className="flex items-center gap-1 mt-0.5">
      {entries.slice(-5).map((e, i) => {
        const hit = tgt > 0 && e.value >= tgt;
        return (
          <span
            key={i}
            title={`vs ${e.opponent}: ${e.value}${e.minutes != null ? ` · ${e.minutes}m` : ''}`}
            className={cn(
              'inline-flex items-center justify-center min-w-[16px] h-[16px] px-0.5 rounded text-[9px] font-mono font-bold border',
              hit
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'bg-white/[0.02] border-white/8 text-muted-foreground/50'
            )}
          >
            {e.value}
          </span>
        );
      })}
      <span className="text-[8px] font-bold text-muted-foreground/40 ml-0.5">
        μ{average.toFixed(1)}
      </span>
    </div>
  );
}

// ── Chip de Odd ──────────────────────────────────────────────────────
interface OddChipProps {
  value: number;
  house: string;
  isBest: boolean;
  url?: string;
  onHistoryClick: () => void;
}

function OddChip({ value, isBest, url, onHistoryClick }: OddChipProps) {
  const handleLinkClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="relative w-full group">
      <button
        onClick={handleLinkClick}
        disabled={!url}
        className={cn(
          'w-full h-[42px] rounded-lg flex flex-col items-center justify-center',
          'font-mono font-bold text-xs transition-all duration-200 border cursor-pointer',
          isBest
            ? 'bg-primary/12 border-primary/45 text-primary shadow-sm shadow-primary/10'
            : 'bg-white/[0.02] border-white/5 text-foreground/80 hover:bg-primary/5 hover:border-primary/25 hover:-translate-y-0.5',
          !url && 'opacity-35 cursor-not-allowed border-dashed'
        )}
        title={url ? "Clique para apostar" : "Link não disponível"}
      >
        <span className="leading-none">{formatOdd(value)}</span>
        {isBest && (
          <span className="text-[7px] font-black uppercase tracking-widest text-primary/80 mt-0.5 leading-none">
            ★ best
          </span>
        )}
      </button>

      {/* Histórico — aparece no hover */}
      <button
        onClick={(e) => { e.preventDefault(); onHistoryClick(); }}
        className="absolute -top-1.5 -right-1.5 p-1 rounded-md bg-slate-900/95 border border-white/10
                   opacity-0 group-hover:opacity-100 hover:scale-110
                   transition-all duration-150 z-10"
        title="Ver histórico"
      >
        <BarChart2 className="w-2.5 h-2.5 text-muted-foreground" />
      </button>
    </div>
  );
}
