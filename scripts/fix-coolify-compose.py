#!/usr/bin/env python3
"""Fix the Coolify docker-compose.yml to add auth env vars to grudge-id"""
import re

path = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'

with open(path, 'r') as f:
    content = f.read()

# Remove all broken lines from previous sed attempts
lines_to_remove = [
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
    'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'TWILIO_VERIFY_SID', 'DEFAULT_AUTH_REDIRECT', 'ANTHROPIC_API_KEY',
    'CROSSMINT_SERVER_API_KEY', 'CROSSMINT_PROJECT_ID'
]

cleaned_lines = []
for line in content.split('\n'):
    skip = False
    for bad in lines_to_remove:
        if bad in line:
            skip = True
            break
    if not skip:
        cleaned_lines.append(line)

content = '\n'.join(cleaned_lines)

# Insert new env vars after CF_TURNSTILE_SITE_KEY line
new_vars = """      GOOGLE_CLIENT_ID: '${GOOGLE_CLIENT_ID}'
      GOOGLE_CLIENT_SECRET: '${GOOGLE_CLIENT_SECRET}'
      GOOGLE_REDIRECT_URI: '${GOOGLE_REDIRECT_URI}'
      GITHUB_CLIENT_ID: '${GITHUB_CLIENT_ID}'
      GITHUB_CLIENT_SECRET: '${GITHUB_CLIENT_SECRET}'
      GITHUB_REDIRECT_URI: '${GITHUB_REDIRECT_URI}'
      TWILIO_ACCOUNT_SID: '${TWILIO_ACCOUNT_SID}'
      TWILIO_AUTH_TOKEN: '${TWILIO_AUTH_TOKEN}'
      TWILIO_PHONE_NUMBER: '${TWILIO_PHONE_NUMBER}'
      TWILIO_VERIFY_SID: '${TWILIO_VERIFY_SID}'
      DEFAULT_AUTH_REDIRECT: '${DEFAULT_AUTH_REDIRECT}'
      ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}'
      CROSSMINT_SERVER_API_KEY: '${CROSSMINT_SERVER_API_KEY}'
      CROSSMINT_PROJECT_ID: '${CROSSMINT_PROJECT_ID}'"""

content = content.replace(
    "      CF_TURNSTILE_SITE_KEY: '${CF_TURNSTILE_SITE_KEY}'",
    "      CF_TURNSTILE_SITE_KEY: '${CF_TURNSTILE_SITE_KEY}'\n" + new_vars
)

with open(path, 'w') as f:
    f.write(content)

print(f"Fixed! GOOGLE_CLIENT_ID count: {content.count('GOOGLE_CLIENT_ID')}")
