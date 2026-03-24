#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Install Ollama on VPS — Free self-hosted LLM
# Models: llama3.2 (3B), mistral (7B), codellama (7B)
# ═══════════════════════════════════════════════════════════

echo "=== Installing Ollama ==="
curl -fsSL https://ollama.com/install.sh | sh

echo ""
echo "=== Starting Ollama service ==="
systemctl enable ollama 2>/dev/null || true
systemctl start ollama 2>/dev/null || nohup ollama serve &>/dev/null &
sleep 5

echo ""
echo "=== Pulling llama3.2 (3B — fast, low memory) ==="
ollama pull llama3.2

echo ""
echo "=== Verify ==="
ollama list
curl -sf http://localhost:11434/api/tags && echo "" || echo "Ollama NOT responding"

echo ""
echo "=== Add to Coolify .env ==="
COOLIFY_ENV="/data/coolify/services/l7kwyegn8qmocpfweql206ep/.env"
grep -q "OLLAMA_URL" "$COOLIFY_ENV" || echo "OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2" >> "$COOLIFY_ENV"
echo "   Ollama env added"

echo ""
echo "=== DONE — Ollama ready at http://localhost:11434 ==="
echo "   Docker containers access it via: http://host.docker.internal:11434"
echo "   Test: curl http://localhost:11434/api/chat -d '{\"model\":\"llama3.2\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}],\"stream\":false}'"
