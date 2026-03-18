# Ubuntu 22.04 matches the build target for the Unity Linux server
FROM ubuntu:22.04

# Unity Linux dependencies
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libglib2.0-dev \
    libc6 \
    libstdc++6 \
    libgcc-s1 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxtst6 \
    libxi6 \
    libgl1-mesa-glx \
    libglu1-mesa \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/grudge-server

# Copy the Linux server binary and data
# The bin/ directory is excluded from git - upload separately
COPY grudge-headless/bin/ ./bin/
COPY grudge-headless/config/ ./config/
COPY grudge-headless/scripts/ ./scripts/

RUN chmod +x ./bin/GrudgeLinuxServer.x86_64 \
    && chmod +x ./scripts/*.sh

EXPOSE 7777/tcp
EXPOSE 7777/udp

VOLUME ["/opt/grudge-server/data", "/opt/grudge-server/logs"]

COPY grudge-headless/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
