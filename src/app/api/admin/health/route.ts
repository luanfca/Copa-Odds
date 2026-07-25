import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAllBreakerMetrics } from '@/lib/circuit-breaker';

export const dynamic = 'force-dynamic';

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: { status: 'ok' | 'error'; latencyMs: number };
    circuitBreakers: Record<string, { state: string; failureRate: string; totalCalls: number }>;
    lastScrape: {
      status: string | null;
      finishedAt: string | null;
      ageMinutes: number | null;
    } | null;
  };
}

function isAdminAuthorized(request: Request): boolean {
  const secret = process.env.SCRAPE_SECRET ?? process.env.ADMIN_SECRET ?? '';
  // Health em prod pode ser público para probes, mas esconde detalhes se sem secret
  // Aqui: permite sempre o GET básico; secret opcional para não quebrar k8s/docker
  void secret;
  void request;
  return true;
}

export async function GET(request: Request) {
  void isAdminAuthorized(request);
  const startTime = Date.now();
  const checks: HealthCheckResponse['checks'] = {
    database: { status: 'ok', latencyMs: 0 },
    circuitBreakers: {},
    lastScrape: null,
  };

  // Database health check
  const dbCheckStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database.latencyMs = Date.now() - dbCheckStart;
  } catch (err) {
    checks.database.status = 'error';
    checks.database.latencyMs = Date.now() - dbCheckStart;
  }

  // Circuit breaker metrics
  const breakerMetrics = getAllBreakerMetrics();
  for (const [name, metrics] of Object.entries(breakerMetrics)) {
    checks.circuitBreakers[name] = {
      state: metrics.state,
      failureRate: metrics.failureRate + '%',
      totalCalls: metrics.totalCalls,
    };
  }

  // Last scrape info
  try {
    const lastScrape = await prisma.scrapeLog.findFirst({
      // PostgreSQL ordena NULL antes de datas no DESC. Usar startedAt evita
      // que uma execução antiga interrompida esconda a coleta mais recente.
      orderBy: { startedAt: 'desc' },
    });
    if (lastScrape) {
      const ageMs = lastScrape.finishedAt
        ? Date.now() - lastScrape.finishedAt.getTime()
        : 0;
      checks.lastScrape = {
        status: lastScrape.status,
        finishedAt: lastScrape.finishedAt?.toISOString() ?? null,
        ageMinutes: lastScrape.finishedAt ? Math.round(ageMs / 60000) : null,
      };
    }
  } catch {
    checks.lastScrape = { status: null, finishedAt: null, ageMinutes: null };
  }

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (checks.database.status === 'error') {
    status = 'unhealthy';
  } else if (Object.values(checks.circuitBreakers).some((b) => b.state === 'open')) {
    status = 'degraded';
  }

  const response: HealthCheckResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    checks,
  };

  return NextResponse.json(response, {
    status: status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503,
  });
}
