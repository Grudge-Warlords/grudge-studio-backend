#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Grudge Studio — Manual Rollback
#
# Reverts one or more services to their :previous Docker image.
# The :previous tag is created automatically by every deploy.
#
# Usage:
#   bash scripts/rollback.sh grudge-id            # rollback one
#   bash scripts/rollback.sh grudge-id game-api    # rollback several
#   bash scripts/rollback.sh --all                 # rollback everything
#   bash scripts/rollback.sh --list                # show available :previous images
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-/opt/grudge-studio-backend}"
cd "$BACKEND_DIR"

PROJECT="grudge-studio-backend"
COMPOSE="docker compose -p $PROJECT -f docker-compose.yml -f docker-compose.prod.yml"
ALL_SERVICES="ai-agent wallet-service account-api launcher-api asset-service game-api grudge-id ws-service"

# ── List available :previous images ───────────────────────────
if [[ "${1:-}" == "--list" ]]; then
  echo "Available :previous images:"
  docker images --format '{{.Repository}}:{{.Tag}}  ({{.CreatedSince}})' | grep ':previous' | sort
  exit 0
fi

# ── Determine targets ────────────────────────────────────────
if [[ "${1:-}" == "--all" ]]; then
  TARGETS="$ALL_SERVICES"
  echo "═══ Rolling back ALL services ═══"
else
  TARGETS="$*"
  if [ -z "$TARGETS" ]; then
    echo "Usage: rollback.sh <service1> [service2...] | --all | --list"
    exit 1
  fi
  echo "═══ Rolling back: $TARGETS ═══"
fi

FAIL=0

for SVC in $TARGETS; do
  echo ""
  echo "▶ $SVC"

  PREV=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "${SVC}.*:previous" | head -1)
  if [ -z "$PREV" ]; then
    echo "  ⚠ No :previous image found — skipping"
    FAIL=$((FAIL + 1))
    continue
  fi

  echo "  Found: $PREV"

  # Stop and remove current container
  docker stop "$SVC" 2>/dev/null || true
  docker rm "$SVC" 2>/dev/null || true

  # Re-tag :previous as :latest so compose uses it
  docker tag "$PREV" "${PREV%%:*}:latest" 2>/dev/null || true

  # Bring back up without building
  $COMPOSE up -d --no-deps --no-build "$SVC"
  echo "  ✓ $SVC rolled back"

  # Quick health check
  sleep 5
  STATUS=$(docker inspect --format='{{.State.Status}}' "$SVC" 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "running" ]; then
    echo "  ✅ $SVC running"
  else
    echo "  ❌ $SVC status: $STATUS"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo ">>> Final status:"
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}"

echo ""
if [ $FAIL -gt 0 ]; then
  echo "═══ ⚠ Rollback completed with $FAIL issue(s) ═══"
  exit 1
fi
echo "═══ ✅ Rollback complete ═══"
