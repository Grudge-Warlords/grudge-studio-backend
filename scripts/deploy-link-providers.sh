#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Grudge Studio — Deploy: Link-Providers Flow
#   Smaller-blast-radius cousin of deploy-migrate.sh.
#   Only:
#     1. Applies migration 02-user-providers-link-flow.sql (idempotent).
#     2. Rebuilds + restarts the grudge-id service.
#     3. Verifies grudge-id health on :3001.
#   No other services are touched.
#
#   Run on VPS: bash /opt/grudge-studio-backend/scripts/deploy-link-providers.sh
#   Dry run:    DRY_RUN=1 bash /opt/grudge-studio-backend/scripts/deploy-link-providers.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

BASE="${BASE:-/opt/grudge-studio-backend}"
SERVICE="grudge-id"
PORT=3001
DRY_RUN="${DRY_RUN:-0}"

cd "${BASE}"

run_or_echo() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "  [dry-run] $*"
  else
    echo "  ▶ $*"
    "$@"
  fi
}

# 1. Pull latest code if this is a git checkout.
if [[ -d .git ]]; then
  echo "── Pulling latest code"
  run_or_echo git fetch --quiet origin main
  run_or_echo git reset --hard origin/main
fi

# 2. Run migrations. The existing scripts/migrate.sh is idempotent —
#    it tracks applied files in the `grudge_migrations` table and
#    skips anything that's already been run, so calling it on every
#    deploy is safe (and re-runs only newly-added migrations).
echo ""
echo "── Running migrations"
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "  [dry-run] bash ${BASE}/scripts/migrate.sh  (idempotent — would skip applied files)"
else
  bash "${BASE}/scripts/migrate.sh"
fi

# 3. Rebuild + restart grudge-id only.
echo ""
echo "── Rebuilding ${SERVICE}"
run_or_echo docker compose build --build-arg BUILDKIT_INLINE_CACHE=1 "${SERVICE}"
echo ""
echo "── Restarting ${SERVICE}"
run_or_echo docker compose up -d --no-deps "${SERVICE}"

# 4. Health check.
echo ""
echo "── Health check (port ${PORT})"
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "  [dry-run] curl -sf http://localhost:${PORT}/health"
  exit 0
fi

sleep 6
for i in 1 2 3 4 5; do
  if curl -sf "http://localhost:${PORT}/health" > /dev/null; then
    echo "  ✅ ${SERVICE} healthy"
    echo ""
    echo "── New endpoints now available:"
    echo "     GET    /auth/links"
    echo "     POST   /auth/links/start"
    echo "     GET    /auth/links/callback/:provider"
    echo "     DELETE /auth/links/:provider/:providerUid"
    echo "     POST   /auth/links/merge"
    exit 0
  fi
  echo "  …waiting (${i}/5)"
  sleep 4
done

echo "  ❌ ${SERVICE} did not become healthy — check 'docker compose logs ${SERVICE}'"
exit 1
