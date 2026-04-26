#!/usr/bin/env python3
"""Inject missing auth env vars into Coolify .env and docker-compose.yml"""
import os
import sys

BASE = '/data/coolify/services/l7kwyegn8qmocpfweql206ep'
ENV_PATH = os.path.join(BASE, '.env')
COMPOSE_PATH = os.path.join(BASE, 'docker-compose.yml')

def require_env(name):
    """Return the value of a required environment variable, exiting with a clear message if missing."""
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: required environment variable '{name}' is not set. "
              "Export all credentials before running this script.", file=sys.stderr)
        sys.exit(1)
    return val

# Auth vars to add — values are read from environment variables.
# Set each variable in your shell (or CI secrets) before running this script.
AUTH_VARS = {
    'GOOGLE_CLIENT_ID': require_env('GOOGLE_CLIENT_ID'),
    'GOOGLE_CLIENT_SECRET': require_env('GOOGLE_CLIENT_SECRET'),
    'GOOGLE_REDIRECT_URI': os.environ.get('GOOGLE_REDIRECT_URI', 'https://id.grudge-studio.com/auth/google/callback'),
    'GITHUB_CLIENT_ID': require_env('GITHUB_CLIENT_ID'),
    'GITHUB_CLIENT_SECRET': require_env('GITHUB_CLIENT_SECRET'),
    'GITHUB_REDIRECT_URI': os.environ.get('GITHUB_REDIRECT_URI', 'https://id.grudge-studio.com/auth/github/callback'),
    'TWILIO_ACCOUNT_SID': require_env('TWILIO_ACCOUNT_SID'),
    'TWILIO_AUTH_TOKEN': require_env('TWILIO_AUTH_TOKEN'),
    'TWILIO_PHONE_NUMBER': require_env('TWILIO_PHONE_NUMBER'),
    'TWILIO_VERIFY_SID': require_env('TWILIO_VERIFY_SID'),
    'DEFAULT_AUTH_REDIRECT': os.environ.get('DEFAULT_AUTH_REDIRECT', 'https://grudgewarlords.com/auth'),
    'ANTHROPIC_API_KEY': require_env('ANTHROPIC_API_KEY'),
    'CROSSMINT_SERVER_API_KEY': require_env('CROSSMINT_SERVER_API_KEY'),
    'CROSSMINT_PROJECT_ID': require_env('CROSSMINT_PROJECT_ID'),
    'COLYSEUS_CLOUD_TOKEN': require_env('COLYSEUS_CLOUD_TOKEN'),
    'DOMAIN_CLIENT': os.environ.get('DOMAIN_CLIENT', 'client.grudge-studio.com'),
    'DOMAIN_WALLET': os.environ.get('DOMAIN_WALLET', 'wallet.grudge-studio.com'),
}

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
