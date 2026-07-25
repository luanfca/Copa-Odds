import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Navbar } from '@/components/Navbar';
import { Toaster } from '@/components/ui/toaster';
import { MouseTracker } from '@/components/MouseTracker';
import { ClientSideComponents } from '@/components/ClientSideComponents';

export const metadata: Metadata = {
  title: 'Brasileirão Odds — Desarmes do Brasileirão Série A',
  description:
    'Agregue e compare odds de desarmes, faltas, finalizações e chutes ao gol por jogador nos jogos do Brasileirão Série A. Betfair, BetMGM, Superbet e Pitaco lado a lado.',
  keywords: ['brasileirão', 'odds', 'desarmes', 'faltas', 'finalização', 'chute ao gol', 'apostas', 'betfair', 'betmgm', 'superbet', 'pitaco'],
  openGraph: {
    title: 'Brasileirão Odds — Desarmes do Brasileirão Série A',
    description: 'Compare odds de desarmes entre Betfair, BetMGM, Superbet e Pitaco',
    type: 'website',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Odds ao Vivo',
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
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
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
        <ClientSideComponents />
      </body>
    </html>
  );
}
