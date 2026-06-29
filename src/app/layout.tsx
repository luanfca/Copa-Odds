import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Navbar } from '@/components/Navbar';
import { Toaster } from '@/components/ui/toaster';
import { MouseTracker } from '@/components/MouseTracker';

export const metadata: Metadata = {
  title: 'Copa Odds — Desarmes da Copa do Mundo',
  description:
    'Agregue e compare odds de desarmes, faltas cometidas e faltas sofridas por jogador nos jogos da Copa do Mundo. Betfair, BetMGM e Superbet lado a lado.',
  keywords: ['copa do mundo', 'odds', 'desarmes', 'faltas', 'tackles', 'apostas', 'betfair', 'betmgm', 'superbet'],
  openGraph: {
    title: 'Copa Odds — Desarmes da Copa do Mundo',
    description: 'Compare odds de desarmes entre Betfair, BetMGM e Superbet',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className={cn(
          'min-h-screen bg-background font-sans antialiased',
          'selection:bg-primary/20 selection:text-primary'
        )}
      >
        <Navbar />
        <main className="container mx-auto px-4 py-8 max-w-7xl">
          {children}
        </main>
        <Toaster />
        <MouseTracker />
      </body>
    </html>
  );
}
