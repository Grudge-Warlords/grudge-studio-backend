FROM node:20-alpine AS base
WORKDIR /app/game-api
COPY game-api/package.json .
COPY shared /app/shared

FROM base AS development
RUN npm install
COPY game-api/src ./src
COPY game-api/public ./public
EXPOSE 3003
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY game-api/src ./src
COPY game-api/public ./public
EXPOSE 3003
CMD ["node", "src/index.js"]
