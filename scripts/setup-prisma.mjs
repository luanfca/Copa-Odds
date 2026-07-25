#!/usr/bin/env node
/**
 * Prisma schema generator for environment-specific provider.
 * Run this before `prisma generate` or `prisma db push`.
 *
 * Usage:
 *   node scripts/setup-prisma.mjs
 *
 * Detects DATABASE_URL and generates the appropriate schema:
 *   - file:... → SQLite
 *   - postgresql:... → PostgreSQL
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const schemaPath = join(projectRoot, 'prisma', 'schema.prisma');

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const usesPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');
const provider = usesPostgres ? 'postgresql' : 'sqlite';

console.log(`[setup-prisma] Detected provider: ${provider} (DATABASE_URL=${dbUrl.startsWith('file:') ? 'file:...' : 'postgresql://***'})`);

// Read the base schema template
let schema = readFileSync(schemaPath, 'utf-8');

// Replace the datasource provider
schema = schema.replace(
  /provider\s*=\s*"(sqlite|postgresql)"/,
  `provider = "${provider}"`,
);

writeFileSync(schemaPath, schema, 'utf-8');
console.log(`[setup-prisma] Updated schema.prisma with provider: ${provider}`);

// Run prisma generate
import { execSync } from 'child_process';
try {
  execSync('npx prisma generate', { cwd: projectRoot, stdio: 'inherit' });
  console.log('[setup-prisma] Prisma client generated successfully.');
} catch (err) {
  console.error('[setup-prisma] Failed to generate Prisma client:', err.message);
  process.exit(1);
}
