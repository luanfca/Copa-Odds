/**
 * Endpoint WebSocket para conexão em tempo real.
 * 
 * Conecte-se via: ws://localhost:3000/api/ws
 */

import { NextRequest } from 'next/server';
import { wsServer } from '@/lib/ws-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // WebSocket connections are handled differently in Next.js
  // This endpoint serves as a marker - actual WS handling is in ws-server.ts
  return new Response('WebSocket endpoint ready', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}
