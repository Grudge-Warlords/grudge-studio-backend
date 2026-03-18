FROM node:20-alpine AS base
WORKDIR /app
COPY services/game-api/package.json .

FROM base AS development
RUN npm install
COPY services/game-api/src ./src
COPY services/game-api/public ./public
COPY shared /shared
EXPOSE 3003
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY services/game-api/src ./src
COPY services/game-api/public ./public
COPY shared /shared
EXPOSE 3003
CMD ["node", "src/index.js"]
