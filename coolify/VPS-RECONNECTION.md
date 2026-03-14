# Grudge Studio — VPS Reconnection Guide
Last updated: 2026-03-14

## VPS Inventory

### VPS1: 74.208.155.229 (Linux)
- **Provider**: IONOS
- **OS**: Linux (Ubuntu — confirmed via SSH host keys)
- **Purpose**: Primary backend — Coolify, Traefik, Docker stack
- **Status**: COMPLETELY UNREACHABLE
  - SSH (22): Timeout
  - HTTP (80): Timeout
  - HTTPS (443): Timeout
  - RDP (3389): Timeout
  - Coolify (8000): Timeout
  - Ping: No response
- **Diagnosis**: Server is likely powered off, suspended, or has a network/firewall issue at the provider level
- **SSH Keys**: Previously accepted connections (in known_hosts)
- **Recovery**: Must use IONOS control panel → Server Management → Power On / KVM Console

### VPS2: 74.208.174.62 (Windows)
- **Provider**: IONOS
- **OS**: Windows Server (OpenSSH_for_Windows_9.5, IIS 10.0)
- **Purpose**: Secondary — game server / Windows services
- **Status**: PARTIALLY ONLINE
  - SSH (22): OPEN — but key auth fails (keys not installed on server)
  - HTTP (80): OPEN — serving default IIS landing page
  - HTTPS (443): Closed
  - RDP (3389): OPEN — Remote Desktop accessible
  - Coolify (8000): Closed
  - Docker: Not confirmed running
- **Diagnosis**: Server is running but SSH keys were never added to `authorized_keys`. RDP is the working access method.
- **Recovery**: Connect via RDP, then configure SSH keys and Docker

## Recovery Procedures

### VPS1 (Linux) — Bring Back Online

1. **Log into IONOS** at https://my.ionos.com
2. Navigate to **Servers & Cloud** → find server 74.208.155.229
3. Check status — if stopped, **Power On**
4. If running but unreachable, open **KVM Console** (virtual screen)
5. From KVM console, run:
   ```bash
   # Check network
   ip addr show
   systemctl restart networking

   # Check/fix firewall
   ufw status
   ufw allow ssh
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw allow 8000/tcp

   # Restart SSH
   systemctl restart sshd

   # If disk is full (common cause of crashes)
   df -h /
   docker system prune -af
   journalctl --vacuum-time=1d
   ```
6. Once SSH is restored, from local machine:
   ```powershell
   ssh -i C:\Users\david\.ssh\grudge_deploy root@74.208.155.229
   # or
   ssh -i C:\Users\david\.ssh\coolify_vps root@74.208.155.229
   ```

### VPS2 (Windows) — Fix SSH + Setup Docker

1. **Connect via RDP** from local machine:
   ```powershell
   mstsc /v:74.208.174.62
   ```
   Use your IONOS Windows admin credentials (check IONOS panel for initial password)

2. **Fix SSH key auth** (from RDP session, in PowerShell as Admin):
   ```powershell
   # For regular user
   mkdir C:\Users\david\.ssh -Force
   # Paste your public key:
   Set-Content C:\Users\david\.ssh\authorized_keys "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKq6hBTxtHHWoRvqpjZ1Y/okEk/nzcGtEnSJGl17JaJE grudge-deploy-local"

   # For Administrator (OpenSSH puts admin keys in a different file)
   Set-Content C:\ProgramData\ssh\administrators_authorized_keys "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKq6hBTxtHHWoRvqpjZ1Y/okEk/nzcGtEnSJGl17JaJE grudge-deploy-local"
   # Fix permissions
   icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "SYSTEM:(F)" /grant "Administrators:(F)"

   # Restart SSH
   Restart-Service sshd
   ```

3. **Install Docker Desktop** (if not installed):
   ```powershell
   # Download and install Docker Desktop for Windows
   Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile "$env:TEMP\DockerInstaller.exe"
   Start-Process "$env:TEMP\DockerInstaller.exe" -ArgumentList "install --quiet" -Wait
   # Restart required after install
   ```

4. **Verify after SSH fix** (from local machine):
   ```powershell
   ssh -i C:\Users\david\.ssh\grudge_deploy Administrator@74.208.174.62 "hostname; docker --version"
   ```

## SSH Keys on File

| Key | File | Fingerprint |
|-----|------|-------------|
| grudge_deploy | `~/.ssh/grudge_deploy` | ED25519 (has .pub) |
| coolify_vps | `~/.ssh/coolify_vps` | ED25519 (no .pub file) |

Public key to install on both VPS:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKq6hBTxtHHWoRvqpjZ1Y/okEk/nzcGtEnSJGl17JaJE grudge-deploy-local
```

## Recommended Architecture

```
VPS1 (74.208.155.229) — Linux
├── Coolify (manages deploys)
├── Traefik (reverse proxy + SSL)
├── grudge-id (3001)
├── game-api (3003)
├── account-api (3005)
├── launcher-api (3006)
├── ws-service (3007)
├── asset-service (3008)
├── wallet-service (3002, internal)
├── ai-agent-service (3004, internal)
├── MySQL 8.0
├── Redis 7
└── Uptime Kuma

VPS2 (74.208.174.62) — Windows
├── grudge-headless (Unity game server, port 7777)
├── IIS (serves any Windows-only game assets)
└── Docker Desktop (optional, for containerized builds)
```

## DNS Mapping (Cloudflare)

Once VPS1 is back:
```
*.grudge-studio.com subdomains → 74.208.155.229 (Proxied)
game.grudge-studio.com        → 74.208.174.62  (DNS only, UDP)
dash.grudge-studio.com        → 76.76.21.21    (Vercel, DNS only)
```
