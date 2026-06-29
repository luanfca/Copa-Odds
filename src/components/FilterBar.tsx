'use client';

import { Search, Filter, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  onSearch: (q: string) => void;
  onHouseFilter: (house: string) => void;
}

const HOUSES = [
  { value: '', label: 'Todas as casas' },
  { value: 'betfair', label: 'Betfair', color: '#F6C543' },
  { value: 'betmgm', label: 'BetMGM', color: '#4A90E2' },
  { value: 'superbet', label: 'Superbet', color: '#E84A5F' },
  { value: 'pitaco', label: 'Pitaco', color: '#00C853' },
];

export function FilterBar({ onSearch, onHouseFilter }: FilterBarProps) {
  const [search, setSearch] = useState('');
  const [house, setHouse] = useState('');
  const [houseOpen, setHouseOpen] = useState(false);

  function handleSearch(v: string) {
    setSearch(v);
    onSearch(v);
  }

  function handleHouse(v: string) {
    setHouse(v);
    setHouseOpen(false);
    onHouseFilter(v);
  }

  const selectedHouse = HOUSES.find(h => h.value === house);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Busca */}
      <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar jogador ou time..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="alert-input pl-10"
        />
      </div>

      {/* Filtro por casa */}
      <div className="relative">
        <button
          onClick={() => setHouseOpen(!houseOpen)}
          className={cn(
            'flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold',
            'border border-border/30 bg-muted/10 hover:bg-muted/20',
            'transition-all duration-200 backdrop-blur-md',
            house && 'border-primary/45 shadow-sm shadow-primary/5'
          )}
        >
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span style={{ color: selectedHouse?.color || undefined }}>
            {selectedHouse?.label || 'Casa'}
          </span>
          <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground/75 transition-transform duration-200', houseOpen && 'rotate-180')} />
        </button>

        {houseOpen && (
          <div className="absolute top-full left-0 mt-2 w-48 rounded-xl border border-border/40
                           bg-card/95 shadow-2xl backdrop-blur-xl overflow-hidden z-20 scale-in">
            {HOUSES.map(h => (
              <button
                key={h.value}
                onClick={() => handleHouse(h.value)}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left font-medium',
                  'hover:bg-muted/40 transition-colors',
                  house === h.value && 'bg-primary/10 text-primary'
                )}
              >
                {h.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: h.color }}
                  />
                )}
                <span style={{ color: h.color ? h.color : undefined }}>
                  {h.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
