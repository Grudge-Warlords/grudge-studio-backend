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
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/grudge-server

# Copy the Linux server binary and data
# The bin/ directory is excluded from git — upload separately via:
#   bash scripts/upload-headless-binary.sh /path/to/LinuxBuild
COPY bin/ ./bin/
COPY config/ ./config/
COPY scripts/ ./scripts/

# Make server binary and scripts executable (ignore errors if bin is empty placeholder)
RUN chmod +x ./bin/GrudgeLinuxServer.x86_64 2>/dev/null || true \
    && chmod +x ./scripts/*.sh 2>/dev/null || true

EXPOSE 7777/tcp
EXPOSE 7777/udp

VOLUME ["/opt/grudge-server/data", "/opt/grudge-server/logs"]

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
