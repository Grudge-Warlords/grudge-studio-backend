#!/usr/bin/env python3
"""Inject missing auth env vars into Coolify .env and docker-compose.yml"""
import os

BASE = '/data/coolify/services/l7kwyegn8qmocpfweql206ep'
ENV_PATH = os.path.join(BASE, '.env')
COMPOSE_PATH = os.path.join(BASE, 'docker-compose.yml')

# Auth vars to add
AUTH_VARS = {
    'GOOGLE_CLIENT_ID': '315363496440-fou6jr23t7i4o1qve48dopluc9uai5u7.apps.googleusercontent.com',
    'GOOGLE_CLIENT_SECRET': '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',
    'GOOGLE_REDIRECT_URI': 'https://id.grudge-studio.com/auth/google/callback',
    'GITHUB_CLIENT_ID': 'Ov23liJisyomTQA4H2lW',
    'GITHUB_CLIENT_SECRET': 'd5c6c9b439d6f1fd570c96876f9cc4e19a3ee195',
    'GITHUB_REDIRECT_URI': 'https://id.grudge-studio.com/auth/github/callback',
    'TWILIO_ACCOUNT_SID': 'AC88ceed8acaa0070ecad123fe65121b0b',
    'TWILIO_AUTH_TOKEN': 'a0133560f51ca58dc289bde74b5a3ab0',
    'TWILIO_PHONE_NUMBER': '+18449284728',
    'TWILIO_VERIFY_SID': 'VA370f8de25fd5d5c8b0ac6344dba0c90e',
    'DEFAULT_AUTH_REDIRECT': 'https://grudgewarlords.com/auth',
    'ANTHROPIC_API_KEY': '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',
    'CROSSMINT_SERVER_API_KEY': 'sk_production_6627PmBFDZBZzt8ZgeSZ8AiD5e1hUsjyV3K1YQVpkkPEnfwGHhQFaf5ZcMGaVVEKdPWcha3JbHozs3EFdgXquham9jKk6NQLgPeNNfoXMx5JwSJfjBciLNnh7CTqZajhqJ9dqwWDSERrh2bFLPKjwgJ32JLHkhHMcGjBtWCzdLAeWiCTAjr1WyDE4XKnmgTGvQWs2ge4bA66YMwNuiVPEcnW',
    'CROSSMINT_PROJECT_ID': '8410e23e-d003-4061-9b65-7c886a6c46ec',
    'COLYSEUS_CLOUD_TOKEN': 'Njk3ZjU0YzM0Mzk5Nm1LYW85b0Z6ZmU3SEVZN0k1d240dXhKSGdtb1N5bXJT',
    'DOMAIN_CLIENT': 'client.grudge-studio.com',
    'DOMAIN_WALLET': 'wallet.grudge-studio.com',
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
