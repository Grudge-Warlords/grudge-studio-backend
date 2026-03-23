import os

compose_path = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'
c = open(compose_path).read()

# Fix Redis URL: remove password since Coolify Redis has no auth
# Change: redis://:${REDIS_PASSWORD}@redis:6379  ->  redis://redis:6379
c = c.replace("redis://:${REDIS_PASSWORD}@redis:6379", "redis://redis:6379")
c = c.replace("redis://:${REDIS_PASSWORD}@grudge-redis:6379", "redis://redis:6379")

# Ensure Traefik docker network label is correct for all services
# The coolify proxy network name is "coolify" 
c = c.replace("traefik.docker.network=l7kwyegn8qmocpfweql206ep_coolify", "traefik.docker.network=coolify")

open(compose_path, 'w').write(c)

# Count fixes
print(f"Redis password refs remaining: {c.count('REDIS_PASSWORD@')}")
print(f"redis:6379 refs: {c.count('redis:6379')}")
print(f"Traefik network coolify refs: {c.count('traefik.docker.network=coolify')}")
print("Done!")
