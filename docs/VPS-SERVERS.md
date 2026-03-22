# Grudge Studio — VPS Server Reference

## Linux VPS (Primary Backend)
- **Host:** 74.208.155.229
- **User:** root
- **OS:** Ubuntu 22.04
- **Plesk Admin:** https://74.208.155.229:8443
- **Plesk License:** A00M00-PTQ212-3APS19-CYZ843-P7QD65
- **IPv4:** 74.208.155.229, 74.208.155.234
- **Size:** vps 2 4 120 (2 vCore, 4GB RAM, 120GB NVMe SSD)
- **Firewall:** My firewall policy 1 (.229), My firewall policy (.234)
- **Datacenter:** United States
- **Created:** 09/16/2025
- **Provider:** IONOS

### Services Running
- Docker + Coolify (self-hosted PaaS)
- Traefik reverse proxy
- grudge-id (3001), wallet-service (3002), game-api (3003), ai-agent (3004)
- account-api (3005), launcher-api (3006), ws-service (3007), asset-service (3008)
- MySQL 8, Redis 7, Uptime Kuma

### Deployment Safety Rule (CRITICAL)
- Only **one** active backend stack may be attached to Traefik routes at a time.
- Do not run both legacy compose project `grudge-studio-backend` and Coolify project `l7kwyegn8qmocpfweql206ep` simultaneously with identical router names (`grudge-id`, `account-api`, `launcher-api`, etc.).
- Parallel stacks with identical router labels cause random 200/502/503 flapping due load balancing across healthy + broken backends.
- Before deploy:
  1. Confirm single active project in Coolify.
  2. Verify no duplicate containers per service (`docker ps | grep -E 'grudge-id|account-api|launcher-api|ws-service|asset-service'`).
  3. Validate Redis/MySQL hostnames inside service env point to the same project network.

---

## Windows VPS
- **Host:** 74.208.174.62
- **User:** Administrator
- **OS:** Windows Server 2022
- **Plesk License:** (needs generation)
- **IPv4:** 74.208.174.62
- **Size:** vps 2 4 120 (2 vCore, 4GB RAM, 120GB NVMe SSD)
- **Firewall:** My firewall policy 1
- **Datacenter:** United States
- **Created:** 01/13/2026
- **Provider:** IONOS

---

> **IMPORTANT:** Passwords are stored securely and should NOT be committed to version control.
> Access credentials via secure channels only.
