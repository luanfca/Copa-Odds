/**
 * Servidor WebSocket auto-inicializado em porta separada.
 * 
 * ANTES: dependia do servidor HTTP do Next.js via server-setup.ts,
 * que NUNCA era chamado (código morto). O WebSocket nunca funcionava.
 * 
 * AGORA: cria seu próprio servidor HTTP na porta 3002 (ou WS_PORT env),
 * eliminando a dependência do Next.js e garantindo que sempre funcione.
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const log = (level: string, msg: string, data?: any) => {
  if (typeof window === 'undefined') {
    console.log(`[${level}] [WS] ${msg}`, data || '');
  }
};

type WSMessage = {
  event: string;
  data?: unknown;
  timestamp: number;
};

class WSServer {
  private wss: WebSocketServer | null = null;
  private server: http.Server | null = null;
  private clients: Set<WebSocket> = new Set();
  private initialized = false;

  /**
   * Inicializa o servidor WebSocket em porta própria.
   * Chamado pelo instrumentation hook ou pelos scripts de runtime.
   */
  initialize(port?: number): void {
    if (this.initialized) return;
    this.initialized = true;

    // Default 3002: Next às vezes sobe em 3001 se 3000 estiver ocupada
    const wsPort = port ?? parseInt(process.env.WS_PORT || '3002', 10);

    this.server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('WebSocket server running');
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      log('info', `[WS] Cliente conectado. Total: ${this.clients.size}`);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch {
          // Ignora mensagens inválidas
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        log('info', `[WS] Cliente desconectado. Total: ${this.clients.size}`);
      });

      ws.on('error', (err) => {
        log('error', '[WS] Erro no cliente:', { error: err.message });
        this.clients.delete(ws);
      });
    });

    this.wss.on('error', (err: NodeJS.ErrnoException) => {
      // Em desenvolvimento pode existir outro processo Next já atendendo a
      // porta. Nesse caso, ele continua sendo o servidor válido.
      if (err.code === 'EADDRINUSE') {
        log('info', `[WS] Porta ${wsPort} já está em uso; reutilizando o servidor existente`);
        return;
      }
      log('error', '[WS] Erro no servidor:', { error: err.message });
    });

    this.server.listen(wsPort, () => {
      log('info', `[WS] Servidor WebSocket rodando na porta ${wsPort}`);
    });
  }

  broadcast(message: WSMessage): void {
    // `event` é mantido para clientes antigos; `type` é o contrato atual do hook.
    const data = JSON.stringify({ ...message, type: message.event });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  stop(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.initialized = false;
    log('info', '[WS] Servidor encerrado');
  }
}

// Singleton sem efeito colateral de importação. Isso evita abrir portas durante
// `next build`, quando os Route Handlers são analisados em vários workers.
export const wsServer = new WSServer();

export function broadcastScrapeStart(): void {
  wsServer.broadcast({
    event: 'scrape:start',
    timestamp: Date.now(),
  });
}

export function broadcastScrapeComplete(matchCount: number): void {
  wsServer.broadcast({
    event: 'scrape:complete',
    data: { matchCount },
    timestamp: Date.now(),
  });
}

export function broadcastScrapeError(error: string): void {
  wsServer.broadcast({
    event: 'scrape:error',
    data: { error },
    timestamp: Date.now(),
  });
}

export function broadcastMatchUpdate(matchId: string): void {
  wsServer.broadcast({
    event: 'match:update',
    data: { matchId },
    timestamp: Date.now(),
  });
}

export function broadcastOddsUpdate(matchId: string, playerCount: number): void {
  wsServer.broadcast({
    event: 'odds:update',
    data: { matchId, playerCount },
    timestamp: Date.now(),
  });
}
