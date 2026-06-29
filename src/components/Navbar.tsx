'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trophy, Star, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock, Zap, Shield, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { invalidateMarket } from '@/lib/marketCache';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ScrapeStatusData {
  isRunning: boolean;
  lastLog: {
    status: string;
    finishedAt: string | null;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoDate: string | null): string {
  if (!isoDate) return '';
  const min = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m atrás`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

// ─── StatusPill ──────────────────────────────────────────────────────────────

function StatusPill({ statusData }: { statusData: ScrapeStatusData | null }) {
  if (!statusData) return null;

  const { isRunning, lastLog } = statusData;

  if (isRunning) {
    return (
      <div className="hidden md:flex items-center gap-2 px-3.5 py-1.5 rounded-xl
                       bg-emerald-500/8 border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest text-primary shadow-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        Coletando
      </div>
    );
  }

  if (!lastLog) {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                       bg-white/[0.02] border border-white/5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        <Clock className="w-3.5 h-3.5" />
        Sem coleta
      </div>
    );
  }

  const { status, finishedAt } = lastLog;
  const time = relativeTime(finishedAt);

  if (status === 'success') {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                       bg-emerald-500/8 border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest text-primary">
        <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
        <span>Ativo · {time}</span>
      </div>
    );
  }
  if (status === 'partial') {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                       bg-amber-500/8 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span>Parcial · {time}</span>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                       bg-rose-500/8 border border-rose-500/20 text-[10px] font-black uppercase tracking-widest text-rose-400 animate-pulse">
        <XCircle className="w-3.5 h-3.5 text-rose-400" />
        <span>Falhou</span>
      </div>
    );
  }

  return null;
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

export function Navbar() {
  const pathname = usePathname();
  const [scraping, setScraping] = useState(false);
  const [statusData, setStatusData] = useState<ScrapeStatusData | null>(null);
  const { toast } = useToast();

  const navLinks = [
    { href: '/',                    label: 'Jogos',           icon: Trophy   },
    { href: '/desarmes',            label: 'Desarmes',        icon: Shield   },
    { href: '/faltas-cometidas',    label: 'Faltas Cometidas', icon: AlertTriangle },
    { href: '/faltas-sofridas',     label: 'Faltas Sofridas',  icon: Heart    },
    { href: '/value-odds',          label: 'Desajustes',      icon: Zap      },
    { href: '/favorites',           label: 'Favoritos',       icon: Star     },
  ];

  // Polling do status de scraping (a cada 30s em background)
  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/scrape', { cache: 'no-store' });
        if (res.ok) setStatusData(await res.json());
      } catch { /* ignora erros de network no background */ }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleScrape() {
    if (scraping) return;
    setScraping(true);
    try {
      const res = await fetch('/api/scrape', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast({
        title: '🔄 Varredura iniciada',
        description: body.message,
      });
      invalidateMarket();
      // Atualiza status local para "running"
      setStatusData(prev => prev
        ? { ...prev, isRunning: true }
        : { isRunning: true, lastLog: null }
      );
    } catch (err) {
      toast({
        title: 'Erro ao iniciar coleta',
        description: String(err),
        variant: 'destructive',
      });
    } finally {
      setTimeout(() => setScraping(false), 3_000);
    }
  }

  return (
    <nav
      className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-2xl shadow-xl"
      style={{ background: 'rgba(9, 14, 28, 0.8)' }}
    >
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* ── Logo ─────────────────────────────────────────────────────── */}
          <Link href="/" className="flex items-center gap-3 group flex-shrink-0">
            <div className={cn(
              'relative flex items-center justify-center w-10 h-10 rounded-xl',
              'bg-primary/8 border border-primary/20',
              'group-hover:border-primary/45 group-hover:bg-primary/12',
              'transition-all duration-300',
            )}>
              <Trophy className="w-5 h-5 text-primary" />
              {/* Ping dot */}
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full
                                 rounded-full bg-primary opacity-60 scale-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary scale-75" />
              </span>
            </div>
            <div className="leading-none">
              <div className="text-base font-black tracking-tight flex items-center gap-0.5">
                <span className="text-foreground">Copa</span>
                <span className="text-primary">Odds</span>
              </div>
              <p className="text-[9px] text-muted-foreground/60 font-bold
                            tracking-[0.16em] uppercase leading-none mt-1">
                Desarmes · Faltas
              </p>
            </div>
          </Link>

          {/* ── Links de navegação ────────────────────────────────────────── */}
          <div className="flex items-center gap-1.5">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold',
                  'transition-all duration-300 border border-transparent select-none',
                  pathname === href
                    ? 'bg-primary/10 text-primary border-primary/25 shadow-sm shadow-primary/5'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.02] hover:border-white/5',
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </div>

          {/* ── Status + Coletar ──────────────────────────────────────────── */}
          <div className="flex items-center gap-3 ml-auto">
            {/* Pill de status */}
            <StatusPill statusData={statusData} />

            {/* Botão de coleta manual */}
            <button
              id="btn-scrape"
              onClick={handleScrape}
              disabled={scraping || statusData?.isRunning}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider',
                'border border-white/5 bg-white/[0.02] text-muted-foreground/80',
                'hover:text-foreground hover:border-primary/45 hover:bg-primary/5',
                'active:scale-[0.97] transition-all duration-300 shadow-md',
                (scraping || statusData?.isRunning) && 'opacity-40 cursor-not-allowed pointer-events-none',
              )}
              title="Forçar varredura manual de odds agora"
            >
              <RefreshCw className={cn(
                'w-3.5 h-3.5',
                (scraping || statusData?.isRunning) && 'animate-spin',
              )} />
              <span className="hidden sm:inline">Coletar</span>
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
}
