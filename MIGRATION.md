# Migration Guide: SQLite → PostgreSQL (Supabase Compatible)

## Overview

This project currently uses SQLite for development and can be migrated to PostgreSQL for production deployment (e.g., Supabase, Railway, Neon, AWS RDS).

## Prerequisites

1. A PostgreSQL database (Supabase recommended for easy setup)
2. The connection string in format: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`

## Step 1: Update Environment Variables

Copy `.env.production.example` to `.env` (or set the variable in your hosting platform):

```bash
DATABASE_URL=postgresql://your-user:your-password@your-host.supabase.co:5432/your-db
```

For local development with SQLite, keep:
```bash
DATABASE_URL=file:./dev.db
```

## Step 2: Update Prisma Schema

The `prisma/schema.prisma` has been updated to use `postgresql` provider:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Important changes for PostgreSQL:**
- `DateTime` fields work the same way
- String fields work the same way
- `Boolean` fields work the same way
- `Int` fields work the same way
- `Float` fields work the same way
- CUID IDs (`@id @default(cuid())`) work the same way
- `@@unique` and `@@index` work the same way
- `onDelete: Cascade` works the same way

## Step 3: Generate Prisma Client

```bash
npm run db:generate
```

## Step 4: Push Schema to Database

For a fresh PostgreSQL database:

```bash
npm run db:push
```

Or create a proper migration:

```bash
npx prisma migrate dev --name init_postgresql
```

## Step 5: Migrate Existing Data (SQLite → PostgreSQL)

If you have existing data in SQLite that needs to be migrated:

### Option A: Export/Import via CSV

```bash
# Export from SQLite
sqlite3 dev.db ".mode csv" ".output matches.csv" "SELECT * FROM matches;"
sqlite3 dev.db ".mode csv" ".output players.csv" "SELECT * FROM players;"
sqlite3 dev.db ".mode csv" ".output odd_snapshots.csv" "SELECT * FROM odd_snapshots;"
sqlite3 dev.db ".mode csv" ".output scrape_logs.csv" "SELECT * FROM scrape_logs;"

# Import to PostgreSQL (using psql or Supabase dashboard)
# Use the CSV import feature in Supabase dashboard or:
psql -U your-user -d your-db -c "\COPY matches FROM 'matches.csv' WITH CSV HEADER"
psql -U your-user -d your-db -c "\COPY players FROM 'players.csv' WITH CSV HEADER"
psql -U your-user -d your-db -c "\COPY odd_snapshots FROM 'odd_snapshots.csv' WITH CSV HEADER"
psql -U your-user -d your-db -c "\COPY scrape_logs FROM 'scrape_logs.csv' WITH CSV HEADER"
```

### Option B: Prisma Migration Script

Create a script `scripts/migrate-sqlite-to-postgres.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaClient as SqlitePrismaClient } from '@prisma/client';

// Connect to both databases
const sqlite = new SqlitePrismaClient({ datasources: { db: { url: 'file:./dev.db' } } });
const pg = new PrismaClient();

async function migrate() {
  // Matches
  const matches = await sqlite.match.findMany();
  for (const m of matches) {
    await pg.match.create({ data: m });
  }

  // Players
  const players = await sqlite.player.findMany();
  for (const p of players) {
    await pg.player.create({ data: p });
  }

  // Odd Snapshots
  const snapshots = await sqlite.oddSnapshot.findMany();
  for (const s of snapshots) {
    await pg.oddSnapshot.create({ data: s });
  }

  // Scrape Logs
  const logs = await sqlite.scrapeLog.findMany();
  for (const l of logs) {
    await pg.scrapeLog.create({ data: l });
  }

  console.log('Migration complete!');
  await sqlite.$disconnect();
  await pg.$disconnect();
}

migrate().catch(console.error);
```

## Step 6: Environment Detection

The `src/lib/prisma.ts` file automatically detects the environment:

```typescript
// Development (SQLite)
DATABASE_URL=file:./dev.db → SQLite

// Production (PostgreSQL)
DATABASE_URL=postgresql://... → PostgreSQL
```

No code changes needed — the correct provider is selected automatically.

## Step 7: Deploy to Supabase

1. Create a new Supabase project
2. Copy the connection string from Settings → Database
3. Set `DATABASE_URL` in your hosting platform's environment variables
4. Run `npm run build` and deploy

## Known Differences: SQLite vs PostgreSQL

| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| Boolean | `Boolean` | `Boolean` ✅ |
| DateTime | `DateTime` | `DateTime` ✅ |
| Auto-increment | `@id @default(cuid())` | `@id @default(cuid())` ✅ |
| Unique constraints | `@@unique` | `@@unique` ✅ |
| Indexes | `@@index` | `@@index` ✅ |
| Foreign keys | Yes | Yes ✅ |
| Case sensitivity | Case-insensitive | Case-sensitive (use lowercase) |
| JSON support | Limited | Full JSON/JSONB |
| Concurrency | Single writer | Multi-writer ✅ |

## Rollback Plan

If you need to switch back to SQLite:

1. Change `DATABASE_URL` back to `file:./dev.db`
2. Change `provider` in `schema.prisma` back to `"sqlite"`
3. Run `npx prisma migrate reset` (warns about data loss)
4. Run `npm run db:push`

## Troubleshooting

**Connection refused:**
- Verify your PostgreSQL host is accessible
- Check firewall rules (Supabase allows all connections by default)

**Migration fails:**
- Ensure all tables are empty before `db:push` on a fresh database
- Use `npx prisma migrate dev` for incremental migrations

**DateTime issues:**
- PostgreSQL stores timestamps in UTC
- Convert to local timezone in the frontend (already done in the app)
