#!/bin/bash
set -e

SERVER_DIR="/opt/grudge-server"
LOG_DIR="$SERVER_DIR/logs"
BIN="$SERVER_DIR/bin/GrudgeLinuxServer.x86_64"
SIDECAR="$SERVER_DIR/sidecar/index.js"
PID_FILE="/tmp/unity.pid"

mkdir -p "$LOG_DIR"

echo "[grudge-headless] Starting Unity server..."
echo "[grudge-headless] Max players: ${MAX_PLAYERS:-22}"

# Trap SIGTERM for graceful shutdown — kill both Unity and sidecar
cleanup() {
  echo "[grudge-headless] Shutting down..."
  [ -n "$SIDECAR_PID" ] && kill $SIDECAR_PID 2>/dev/null
  [ -n "$UNITY_PID" ] && kill $UNITY_PID 2>/dev/null
  wait $UNITY_PID 2>/dev/null
  wait $SIDECAR_PID 2>/dev/null
  rm -f "$PID_FILE"
}
trap cleanup SIGTERM SIGINT

# Start Unity headless server
"$BIN" \
  -batchmode \
  -nographics \
  -logFile "$LOG_DIR/server.log" \
  &

UNITY_PID=$!
echo $UNITY_PID > "$PID_FILE"
echo "[grudge-headless] Unity PID: $UNITY_PID"

# Start sidecar process (registration, heartbeat, WS relay)
if [ -f "$SIDECAR" ]; then
  echo "[grudge-headless] Starting sidecar..."
  UNITY_PID_FILE="$PID_FILE" node "$SIDECAR" >> "$LOG_DIR/sidecar.log" 2>&1 &
  SIDECAR_PID=$!
  echo "[grudge-headless] Sidecar PID: $SIDECAR_PID"
else
  echo "[grudge-headless] WARNING: Sidecar not found at $SIDECAR — running without registration"
fi

# Tail logs so Docker can capture output
tail -f "$LOG_DIR/server.log" "$LOG_DIR/sidecar.log" 2>/dev/null &

# Wait for Unity process — if it exits, sidecar health check will also exit
wait $UNITY_PID
UNITY_EXIT=$?

echo "[grudge-headless] Unity exited with code $UNITY_EXIT"
[ -n "$SIDECAR_PID" ] && kill $SIDECAR_PID 2>/dev/null
rm -f "$PID_FILE"
exit $UNITY_EXIT
