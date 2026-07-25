import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton with environment-aware configuration.
 *
 * - Production: Uses PostgreSQL (Supabase, Railway, Neon, etc.)
 *   Set DATABASE_URL=postgresql://... in your environment.
 *
 * - Development: Uses SQLite for zero-config local development.
 *   Set DATABASE_URL=file:./dev.db (default).
 *
 * The DATABASE_URL format determines the provider:
 *   - file:... → SQLite
 *   - postgresql:... → PostgreSQL
 */

const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const usesPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');

// For development with SQLite, ensure the file path is absolute
let resolvedDbUrl = dbUrl;
if (!usesPostgres && !dbUrl.startsWith('file:')) {
  resolvedDbUrl = `file:${dbUrl}`;
}

// Garante que o path SQLite resolvido seja usado (CWD de scripts vs Next)
if (!usesPostgres && resolvedDbUrl !== process.env.DATABASE_URL) {
  process.env.DATABASE_URL = resolvedDbUrl;
}

// Prisma client instance (singleton pattern)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error', 'warn'] : ['error', 'warn'],
    datasources: {
      db: { url: resolvedDbUrl },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Log which database provider is being used.
 */
if (typeof window === 'undefined') {
  console.log(
    `[Prisma] Using ${usesPostgres ? 'PostgreSQL' : 'SQLite'} database: ${usesPostgres ? dbUrl.replace(/:\/\/.*@/, '***@') : resolvedDbUrl}`,
  );
}

export type { PrismaClient };
