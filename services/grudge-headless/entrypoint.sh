#!/bin/bash
set -e

SERVER_DIR="/opt/grudge-server"
LOG_DIR="$SERVER_DIR/logs"
BIN="$SERVER_DIR/bin/GrudgeLinuxServer.x86_64"

mkdir -p "$LOG_DIR"

echo "[grudge-headless] Starting Unity server..."
echo "[grudge-headless] Max players: ${MAX_PLAYERS:-22}"

# Trap SIGTERM for graceful shutdown
trap 'echo "[grudge-headless] Shutting down..."; kill $PID; wait $PID' SIGTERM SIGINT

exec "$BIN" \
  -batchmode \
  -nographics \
  -logFile "$LOG_DIR/server.log" \
  &

PID=$!
echo "[grudge-headless] Server PID: $PID"

# Tail log so Docker can capture output
tail -f "$LOG_DIR/server.log" &

# Wait for server process
wait $PID
