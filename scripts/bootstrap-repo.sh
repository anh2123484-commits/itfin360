#!/usr/bin/env bash
# Siembra un repositorio existente con la documentación, plantillas y scripts de ITFin360,
# y crea las issues del backlog.
#
# Uso:
#   GITHUB_TOKEN=ghp_... ./scripts/bootstrap-repo.sh <owner>/<repo> [rama]
#
# Idempotente: se puede volver a ejecutar; las issues ya existentes no se duplican.
set -euo pipefail

REPO="${1:?Uso: bootstrap-repo.sh <owner>/<repo> [rama]}"
BRANCH="${2:-main}"
: "${GITHUB_TOKEN:?Falta GITHUB_TOKEN}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Clonando $REPO ($BRANCH)"
git clone --depth 1 --branch "$BRANCH" \
  "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" "$WORK/repo" 2>/dev/null \
  || { echo "    rama $BRANCH no encontrada; clonando por defecto"; \
       git clone --depth 1 "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" "$WORK/repo"; }

cd "$WORK/repo"
git checkout -B chore/itfin360-bootstrap

echo "==> Copiando documentación, plantillas y scripts"
mkdir -p docs scripts .github/ISSUE_TEMPLATE
cp "$HERE"/README.md                            ./README.itfin360.md
cp "$HERE"/AGENTS.md                            ./AGENTS.md
cp "$HERE"/docs/*.md "$HERE"/docs/backlog.json  ./docs/
cp "$HERE"/scripts/*.py "$HERE"/scripts/*.sh    ./scripts/
cp "$HERE"/.github/pull_request_template.md     ./.github/
cp "$HERE"/.github/ISSUE_TEMPLATE/*.md          ./.github/ISSUE_TEMPLATE/
chmod +x ./scripts/*.sh

# Si el repo está vacío de README, el nuestro pasa a ser el principal.
[ -f README.md ] || mv README.itfin360.md README.md

git add -A
if git diff --cached --quiet; then
  echo "    sin cambios que commitear"
else
  git -c user.name="ITFin360 bootstrap" -c user.email="bootstrap@local" \
      commit -m "chore: documentación, reglas de agentes y backlog de ITFin360"
  git push -u origin chore/itfin360-bootstrap
  echo "==> Rama subida. Abre la PR:"
  echo "    https://github.com/${REPO}/compare/${BRANCH}...chore/itfin360-bootstrap?expand=1"
fi

echo "==> Creando issues del backlog"
python3 "$HERE/scripts/create-issues.py" "$REPO"

echo "==> Listo."
