#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -f .env.oracle ]]; then
  echo "Arquivo .env.oracle ausente. Execute scripts/deploy/prepare-env.sh primeiro." >&2
  exit 1
fi

docker compose \
  --env-file .env.oracle \
  -f docker-compose.oracle.yml \
  up -d --build --remove-orphans

echo
echo "Containers iniciados. Estado atual:"
docker compose \
  --env-file .env.oracle \
  -f docker-compose.oracle.yml \
  ps

domain="$(sed -n 's/^DOMAIN=//p' .env.oracle | head -n 1)"
echo
echo "O certificado HTTPS pode levar alguns instantes na primeira inicialização."
echo "Site: https://${domain}"
echo "Logs: docker compose --env-file .env.oracle -f docker-compose.oracle.yml logs -f"
