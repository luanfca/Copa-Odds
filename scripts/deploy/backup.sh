#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -f .env.oracle ]]; then
  echo "Arquivo .env.oracle ausente." >&2
  exit 1
fi

compose=(docker compose --env-file .env.oracle -f docker-compose.oracle.yml)
container="$("${compose[@]}" ps -q app)"
if [[ -z "$container" ]]; then
  echo "Container da aplicação não está em execução." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%d-%H%M%S)"
remote_file="/app/data/odds-${timestamp}.db"
local_file="backups/odds-${timestamp}.db"
mkdir -p backups

"${compose[@]}" exec -T app \
  sqlite3 /app/data/odds.db ".backup '${remote_file}'"
docker cp "${container}:${remote_file}" "$local_file"
"${compose[@]}" exec -T app rm -f "$remote_file"
gzip "$local_file"

# Mantém os 14 backups mais recentes.
mapfile -t old_backups < <(find backups -maxdepth 1 -type f -name 'odds-*.db.gz' -printf '%T@ %p\n' \
  | sort -nr | tail -n +15 | cut -d' ' -f2-)
if ((${#old_backups[@]})); then
  rm -f -- "${old_backups[@]}"
fi

echo "Backup criado: ${local_file}.gz"
