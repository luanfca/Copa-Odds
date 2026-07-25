#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -e .env.oracle ]]; then
  echo ".env.oracle já existe. O arquivo não foi sobrescrito." >&2
  exit 1
fi

read -r -p "Domínio DuckDNS (ex.: minhasodds.duckdns.org): " domain
read -r -p "E-mail para o certificado HTTPS: " acme_email
read -r -p "Usuário provisório do site [admin]: " basic_user
basic_user="${basic_user:-admin}"
read -r -s -p "Senha provisória do site: " basic_password
echo

if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Domínio inválido: $domain" >&2
  exit 1
fi
if [[ -z "$acme_email" || -z "$basic_password" ]]; then
  echo "E-mail e senha são obrigatórios." >&2
  exit 1
fi

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  docker_cmd=(sudo docker)
fi

password_hash="$("${docker_cmd[@]}" run --rm caddy:2.10-alpine \
  caddy hash-password --plaintext "$basic_password")"
scrape_secret="$(openssl rand -hex 32)"
admin_secret="$(openssl rand -hex 32)"

cat > .env.oracle <<EOF
DOMAIN=${domain}
ACME_EMAIL=${acme_email}
BASIC_AUTH_USER=${basic_user}
BASIC_AUTH_PASSWORD_HASH='${password_hash}'
SCRAPE_SECRET=${scrape_secret}
ADMIN_SECRET=${admin_secret}
PROXY_URL=
CRON_SCHEDULE=14400000
SCRAPE_ON_START=false
SCRAPE_PROFILE=fast
PLAYWRIGHT_TIMEOUT=45000
SCRAPE_RETRIES=3
BET365_ENABLED=false
BETSSON_ENABLED=false
BETFAIR_ENABLED=true
BETFAIR_USER=
BETFAIR_PASS=
BETMGM_USER=
BETMGM_PASS=
SUPERBET_USER=
SUPERBET_PASS=
PITACO_SESSION_COOKIE=
EOF

chmod 600 .env.oracle
unset basic_password password_hash scrape_secret admin_secret

echo
echo ".env.oracle criado com permissões restritas."
echo "Revise o arquivo e depois execute: bash scripts/deploy/deploy.sh"
