FROM node:20-bookworm AS builder

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Dependências completas são usadas somente para compilar e validar o projeto.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/setup-prisma.mjs ./scripts/setup-prisma.mjs
RUN npm ci

COPY . .
RUN npm run build


FROM node:20-bookworm AS runner

ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# A imagem publicada recebe apenas dependências necessárias em produção.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/setup-prisma.mjs ./scripts/setup-prisma.mjs
RUN npm ci --omit=dev

# Instala somente Chromium e as bibliotecas de sistema necessárias. O proxy
# local do SofaScore usa o navegador real para evitar 403 no datacenter.
RUN npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright

COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/next.config.js ./next.config.js
COPY --chown=node:node scripts/sofascore-playwright-server.mjs ./scripts/sofascore-playwright-server.mjs

RUN mkdir -p /app/data /app/.playwright-sessions /app/logs \
    && chown -R node:node /app/data /app/.playwright-sessions /app/logs \
       /app/prisma /app/scripts /app/node_modules/.prisma /app/node_modules/@prisma

USER node

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    WS_PORT=3002 \
    DATABASE_URL=file:/app/data/odds.db \
    SOFA_SERVER_URL=http://127.0.0.1:54545

EXPOSE 3000 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/admin/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node scripts/sofascore-playwright-server.mjs & node scripts/setup-prisma.mjs && npx prisma db push --skip-generate && npm start -- -H 0.0.0.0"]
