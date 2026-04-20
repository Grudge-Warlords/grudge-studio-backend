#!/usr/bin/env python3
"""Fix Traefik labels to accept both http and https entrypoints.
Cloudflare may connect via HTTP (Flexible SSL) or HTTPS (Full SSL).
Adding both entrypoints ensures routing works regardless of CF SSL mode."""

path = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'
c = open(path).read()

# For each service, add http entrypoint alongside https
# Current: traefik.http.routers.grudge-id.entrypoints=https
# Need:    traefik.http.routers.grudge-id.entrypoints=http,https

services = ['grudge-id', 'game-api', 'account-api', 'launcher-api', 'ws-service', 'asset-service']

for svc in services:
    old = f'traefik.http.routers.{svc}.entrypoints=https'
    new = f'traefik.http.routers.{svc}.entrypoints=http,https'
    if old in c and new not in c:
        c = c.replace(old, new)
        print(f'  Fixed {svc}: added http entrypoint')
    elif new in c:
        print(f'  OK {svc}: already has http,https')
    else:
        print(f'  SKIP {svc}: label not found')

open(path, 'w').write(c)
print('Done!')
