#!/usr/bin/env bash
# Servicios de desarrollo (Postgres 16, Redis 7, MinIO) vía docker compose.
# Uso: scripts/dev-services.sh up|down|reset
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: se necesita Docker con el plugin 'compose'." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "No hay .env: se copia desde .env.example"
  cp .env.example .env
fi

up() {
  docker compose up -d --wait
  docker compose run --rm minio-init
  docker compose ps
}

case "${1:-}" in
up)
  up
  ;;
down)
  docker compose down --remove-orphans
  ;;
reset)
  docker compose down --volumes --remove-orphans
  up
  ;;
*)
  echo "Uso: scripts/dev-services.sh up|down|reset" >&2
  exit 1
  ;;
esac
