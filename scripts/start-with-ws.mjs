#!/usr/bin/env node

/**
 * Script de startup do Next.js com WebSocket integrado.
 * 
 * Este script substitui o `next dev` padrão e adiciona a inicialização do WebSocket.
 * 
 * Uso:
 * ```bash
 * npx tsx scripts/start-with-ws.mjs
 * ```
 */

import { spawn } from 'child_process';
import { wsServer } from '../src/lib/ws-server.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const WS_PORT = parseInt(
  process.env.WS_PORT || process.env.NEXT_PUBLIC_WS_PORT || '3002',
  10,
);

async function main() {
  console.log('Iniciando Next.js com WebSocket integrado...');
  
  // Inicia o Next.js dev server
  const nextJsProcess = spawn('npx', ['next', 'dev', '--port', String(PORT)], {
    stdio: 'inherit',
    shell: true,
  });

  // Inicializa o servidor separado. Se o instrumentation hook do Next já o
  // iniciou, EADDRINUSE é tratado como reutilização segura.
  wsServer.initialize(WS_PORT);
  console.log(`WebSocket disponível em ws://localhost:${WS_PORT}`);

  // Forward signals
  process.on('SIGINT', () => {
    console.log('\nEncerrando...');
    wsServer.stop();
    nextJsProcess.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    wsServer.stop();
    nextJsProcess.kill();
    process.exit(0);
  });
}

main().catch(console.error);
