import glob
# Find the .env file (might have Windows line ending in path)
import os
base = '/data/coolify/services/l7kwyegn8qmocpfweql206ep'
compose_path = os.path.join(base, 'docker-compose.yml')

c = open(compose_path).read()

# Fix Redis hostname from grudge-redis to redis (Coolify's container name)
c = c.replace('grudge-redis:6379', 'redis:6379')

# Fix MySQL hostname if needed (should be 'mysql' for Coolify)
# Already correct in Coolify compose

open(compose_path, 'w').write(c)
print(f'Fixed Redis hostname. grudge-redis count: {c.count("grudge-redis")}')

# Also check .env exists
env_path = os.path.join(base, '.env')
if os.path.exists(env_path):
    print(f'.env exists ({os.path.getsize(env_path)} bytes)')
    # Check for REDIS_PASSWORD
    env = open(env_path).read()
    if 'REDIS_PASSWORD' in env:
        print('REDIS_PASSWORD found in .env')
    else:
        print('REDIS_PASSWORD missing!')
else:
    print('.env NOT FOUND!')
    # List files
    print(os.listdir(base))
