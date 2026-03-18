FROM node:20-alpine AS base
WORKDIR /app/ai-agent
COPY ai-agent/package.json .
COPY shared /app/shared

FROM base AS development
RUN npm install
COPY ai-agent/src ./src
EXPOSE 3004
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY ai-agent/src ./src
EXPOSE 3004
CMD ["node", "src/index.js"]
