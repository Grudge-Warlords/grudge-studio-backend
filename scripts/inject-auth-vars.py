#!/usr/bin/env python3
"""Inject missing auth env vars into Coolify .env and docker-compose.yml"""
import os

BASE = '/data/coolify/services/l7kwyegn8qmocpfweql206ep'
ENV_PATH = os.path.join(BASE, '.env')
COMPOSE_PATH = os.path.join(BASE, 'docker-compose.yml')

# Auth vars to add
# WARNING: Do NOT hardcode real credentials here. Set these values in the environment
# or in the Coolify .env directly before running this script.
AUTH_VARS = {
    'GOOGLE_CLIENT_ID': os.environ.get('GOOGLE_CLIENT_ID', ''),
    'GOOGLE_CLIENT_SECRET': os.environ.get('GOOGLE_CLIENT_SECRET', ''),
    'GOOGLE_REDIRECT_URI': os.environ.get('GOOGLE_REDIRECT_URI', 'https://id.grudge-studio.com/auth/google/callback'),
    'GITHUB_CLIENT_ID': os.environ.get('GITHUB_CLIENT_ID', ''),
    'GITHUB_CLIENT_SECRET': os.environ.get('GITHUB_CLIENT_SECRET', ''),
    'GITHUB_REDIRECT_URI': os.environ.get('GITHUB_REDIRECT_URI', 'https://id.grudge-studio.com/auth/github/callback'),
    'TWILIO_ACCOUNT_SID': os.environ.get('TWILIO_ACCOUNT_SID', ''),
    'TWILIO_AUTH_TOKEN': os.environ.get('TWILIO_AUTH_TOKEN', ''),
    'TWILIO_PHONE_NUMBER': os.environ.get('TWILIO_PHONE_NUMBER', ''),
    'TWILIO_VERIFY_SID': os.environ.get('TWILIO_VERIFY_SID', ''),
    'DEFAULT_AUTH_REDIRECT': os.environ.get('DEFAULT_AUTH_REDIRECT', 'https://grudgewarlords.com/auth'),
    'ANTHROPIC_API_KEY': os.environ.get('ANTHROPIC_API_KEY', ''),
    'CROSSMINT_SERVER_API_KEY': os.environ.get('CROSSMINT_SERVER_API_KEY', ''),
    'CROSSMINT_PROJECT_ID': os.environ.get('CROSSMINT_PROJECT_ID', ''),
    'COLYSEUS_CLOUD_TOKEN': os.environ.get('COLYSEUS_CLOUD_TOKEN', ''),
    'DOMAIN_CLIENT': os.environ.get('DOMAIN_CLIENT', 'client.grudge-studio.com'),
    'DOMAIN_WALLET': os.environ.get('DOMAIN_WALLET', 'wallet.grudge-studio.com'),
}

# Validate that critical credentials are provided
REQUIRED_VARS = [
    'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET', 'TWILIO_AUTH_TOKEN',
    'ANTHROPIC_API_KEY', 'CROSSMINT_SERVER_API_KEY',
]
missing_required = [k for k in REQUIRED_VARS if not AUTH_VARS.get(k)]
if missing_required:
    import sys
    print(f"ERROR: Missing required environment variables: {', '.join(missing_required)}", file=sys.stderr)
    print("Set these variables in the environment before running this script.", file=sys.stderr)
    sys.exit(1)

# 1. Update .env
print("=== Updating .env ===")
env = open(ENV_PATH).read()
added = 0
for key, val in AUTH_VARS.items():
    if key + '=' not in env:
        env += f'\n{key}={val}'
        added += 1
        print(f'  Added {key}')
    else:
        print(f'  OK {key}')
open(ENV_PATH, 'w').write(env)
print(f'  {added} vars added to .env')

# 2. Update compose — add vars to grudge-id environment
print("\n=== Updating docker-compose.yml ===")
compose = open(COMPOSE_PATH).read()

# Env vars needed in grudge-id compose section
COMPOSE_VARS = [
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
    "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_REDIRECT_URI",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
    "TWILIO_VERIFY_SID", "DEFAULT_AUTH_REDIRECT",
    "ANTHROPIC_API_KEY", "CROSSMINT_SERVER_API_KEY", "CROSSMINT_PROJECT_ID",
]

# Build insertion block
insert_lines = []
for v in COMPOSE_VARS:
    if v not in compose:
        insert_lines.append(f"      {v}: '${{{v}}}'")

if insert_lines:
    # Insert after CF_TURNSTILE_SITE_KEY line
    target = "CF_TURNSTILE_SITE_KEY: '${CF_TURNSTILE_SITE_KEY}'"
    if target in compose:
        insertion = '\n'.join(insert_lines)
        compose = compose.replace(target, target + '\n' + insertion)
        print(f'  Inserted {len(insert_lines)} vars into compose')
    else:
        print('  WARNING: CF_TURNSTILE_SITE_KEY not found in compose')
else:
    print('  All vars already in compose')

# Also fix Redis hostname
compose = compose.replace('grudge-redis:6379', 'redis:6379')

open(COMPOSE_PATH, 'w').write(compose)

# Verify
final_env = open(ENV_PATH).read()
final_compose = open(COMPOSE_PATH).read()
print(f"\n=== Verification ===")
print(f"  .env GOOGLE_CLIENT_ID: {'YES' if 'GOOGLE_CLIENT_ID=' in final_env else 'NO'}")
print(f"  .env TWILIO_VERIFY_SID: {'YES' if 'TWILIO_VERIFY_SID=' in final_env else 'NO'}")
print(f"  compose GOOGLE_CLIENT_ID: {'YES' if 'GOOGLE_CLIENT_ID' in final_compose else 'NO'}")
print(f"  compose TWILIO_VERIFY_SID: {'YES' if 'TWILIO_VERIFY_SID' in final_compose else 'NO'}")
print("Done!")
