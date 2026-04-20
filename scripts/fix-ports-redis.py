#!/usr/bin/env python3
"""Fix service ports and Redis password in Coolify compose.
Services run on PORT from env, but Traefik labels expect specific ports."""
import re

COMPOSE = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'
ENV = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/.env'

c = open(COMPOSE).read()

# The problem: all services get PORT: '3000' from the base .env
# But Traefik labels have specific ports (3001, 3003, 3005, etc.)
# Fix: set PORT per-service to match Traefik label

# Service -> expected port mapping (from Traefik labels)
PORT_MAP = {
    'grudge-id': '3001',
    'game-api': '3003',
    'account-api': '3005',
    'launcher-api': '3006',
    'ws-service': '3007',
    'ai-agent': '3004',
    'wallet-service': '3002',
    'asset-service': '3008',
}

# For each service section, find and fix the PORT line
for svc, port in PORT_MAP.items():
    # Find the service section and its PORT line
    # Pattern: after "container_name: svc-l7k...", find "PORT: '...'"
    pattern = f"(container_name: {svc}-l7kwyeg.*?)(PORT: '[0-9]+')"
    def replacer(m):
        return m.group(1) + f"PORT: '{port}'"
    c = re.sub(pattern, replacer, c, flags=re.DOTALL, count=1)

# Also fix Redis URL with correct password
env_lines = open(ENV).read().split('\n')
redis_pw = ''
for line in env_lines:
    if line.startswith('REDIS_PASSWORD='):
        redis_pw = line.split('=', 1)[1].strip()
        break

if redis_pw:
    redis_url = f"redis://:{redis_pw}@redis:6379"
    c = re.sub(r"REDIS_URL: '.*?'", f"REDIS_URL: '{redis_url}'", c)
    print(f"Redis URL set with password (len={len(redis_pw)})")

open(COMPOSE, 'w').write(c)

# Verify
for svc, port in PORT_MAP.items():
    found = f"PORT: '{port}'" in c
    print(f"  {svc}: PORT={port} {'OK' if found else 'MISSING'}")

print("Done!")
