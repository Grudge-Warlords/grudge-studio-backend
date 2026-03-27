# Grudge Headless — Unity Linux Game Server

Unity Mirror dedicated server running in headless mode on port 7777 (TCP + UDP).

## Directory Structure

```
services/grudge-headless/
├── bin/                    # Unity Linux build output (NOT in git)
│   └── GrudgeLinuxServer.x86_64
├── config/                 # Server config files
├── scripts/                # Runtime scripts
├── Dockerfile
├── entrypoint.sh
└── README.md
```

## Uploading the Unity Binary

The `bin/` directory contains the Unity Linux server build and is **excluded from git** (too large). Upload it to the VPS separately.

### From Windows (local machine → VPS)

```powershell
# Using the upload script (recommended)
bash scripts/upload-headless-binary.sh D:\path\to\LinuxServerBuild

# Manual SCP
scp -r D:\path\to\LinuxServerBuild\* root@74.208.155.229:/opt/grudge-studio-backend/services/grudge-headless/bin/
```

### On the VPS

After uploading, verify the binary:

```bash
ls -la /opt/grudge-studio-backend/services/grudge-headless/bin/GrudgeLinuxServer.x86_64
chmod +x /opt/grudge-studio-backend/services/grudge-headless/bin/GrudgeLinuxServer.x86_64
```

## Building & Running

The headless server uses a Docker **profile** so it doesn't start with the default `docker compose up`:

```bash
# Build and start the game server
docker compose --profile gameserver up -d grudge-headless

# Or use the dedicated deploy script
bash scripts/deploy-headless.sh

# View logs
docker compose logs -f grudge-headless

# Stop
docker compose --profile gameserver stop grudge-headless
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MAX_PLAYERS` | `22` | Maximum concurrent players |
| `DB_HOST` | `mysql` | MySQL host (Docker service name) |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | from `.env` | Database name |
| `DB_USER` | from `.env` | Database user |
| `DB_PASS` | from `.env` | Database password |

## Health Check

The server is monitored via process check (`pgrep -f GrudgeLinuxServer`) since it doesn't expose an HTTP health endpoint. Docker will auto-restart it if the process dies.

## Ports

- **7777/tcp** — Mirror game server (main)
- **7777/udp** — Mirror game server (UDP transport)

Both ports must be open in the VPS firewall:

```bash
ufw allow 7777/tcp
ufw allow 7777/udp
```
