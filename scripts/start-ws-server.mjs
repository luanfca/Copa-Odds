#!/usr/bin/env node

/**
 * Script para iniciar o servidor WebSocket integrado ao Next.js.
 * 
 * Uso:
 * ```bash
 * npx tsx scripts/start-ws-server.mjs
 * ```
 * 
 * Este script deve ser executado APÓS o Next.js iniciar, pois depende do servidor HTTP.
 */

import { wsServer } from '../src/lib/ws-server.ts';

const WS_PORT = parseInt(
  process.env.WS_PORT || process.env.NEXT_PUBLIC_WS_PORT || '3002',
  10,
);

wsServer.initialize(WS_PORT);

console.log('WebSocket iniciado.');
console.log(`Conecte-se via: ws://localhost:${WS_PORT}`);
console.log('');
console.log('Use Ctrl+C para encerrar.');

function shutdown() {
  wsServer.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
