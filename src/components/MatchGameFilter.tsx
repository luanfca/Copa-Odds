'use client';

import { Trophy, Search } from 'lucide-react';
import type { MatchOption } from '@/lib/matchFilter';
import { filterMatchesByTeam } from '@/lib/matchFilter';

type Props = {
  matches: MatchOption[];
  selectedMatch: string;
  onSelectMatch: (id: string) => void;
  teamQuery: string;
  onTeamQueryChange: (q: string) => void;
};

/**
 * Filtro de jogo: lista ordenada por horário + busca por time (casa ou fora).
 * Ex.: digitar "palmeiras" mostra o jogo mesmo se for visitante.
 */
export function MatchGameFilter({
  matches,
  selectedMatch,
  onSelectMatch,
  teamQuery,
  onTeamQueryChange,
}: Props) {
  const filtered = filterMatchesByTeam(matches, teamQuery);
  const selectValue =
    selectedMatch !== 'Todos' && !filtered.some((m) => m.id === selectedMatch)
      ? 'Todos'
      : selectedMatch;

  return (
    <div className="space-y-2 sm:col-span-2">
      <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
        <Trophy className="w-3 h-3" /> Jogo por horário
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar time (ex: palmeiras)..."
            value={teamQuery}
            onChange={(e) => {
              const q = e.target.value;
              onTeamQueryChange(q);
              // Se a busca reduzir a 1 jogo, seleciona automaticamente
              const next = filterMatchesByTeam(matches, q);
              if (q.trim() && next.length === 1) {
                onSelectMatch(next[0].id);
              } else if (!q.trim() && selectedMatch !== 'Todos') {
                // mantém seleção manual
              } else if (q.trim() && next.length !== 1 && selectedMatch !== 'Todos') {
                const still = next.some((m) => m.id === selectedMatch);
                if (!still) onSelectMatch('Todos');
              }
            }}
            className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 pl-8 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
        </div>
        <select
          value={selectValue}
          onChange={(e) => onSelectMatch(e.target.value)}
          className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
        >
          <option value="Todos">
            {teamQuery.trim()
              ? `Todos os filtrados (${filtered.length})`
              : `Todos os jogos (${matches.length})`}
          </option>
          {filtered.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {teamQuery.trim() && filtered.length === 0 && (
        <p className="text-[10px] text-amber-400/80">
          Nenhum jogo com “{teamQuery}” (casa ou fora).
        </p>
      )}
    </div>
  );
}
