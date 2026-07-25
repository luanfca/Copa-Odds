#!/usr/bin/env bash
set -euo pipefail

if [[ ! -r /etc/os-release ]]; then
  echo "Não foi possível identificar o sistema operacional." >&2
  exit 1
fi

source /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *)
    echo "Este instalador suporta Ubuntu e Debian. Sistema encontrado: ${ID:-desconhecido}" >&2
    exit 1
    ;;
esac

echo "Instalando Docker Engine, Compose, Git e utilitários..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

architecture="$(dpkg --print-architecture)"
codename="${VERSION_CODENAME:-}"
if [[ -z "$codename" ]]; then
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
fi

echo "deb [arch=${architecture} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${codename} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

mkdir -p backups

echo
echo "Docker instalado."
echo "Saia do SSH e entre novamente para aplicar o grupo 'docker'."
echo "Depois execute: bash scripts/deploy/prepare-env.sh"
