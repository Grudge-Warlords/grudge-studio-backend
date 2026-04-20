FROM node:22-alpine AS base
WORKDIR /app/game-api
COPY game-api/package.json .
COPY shared /app/shared
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/game-api

FROM base AS development
RUN npm install
RUN ln -s /app/game-api/node_modules /app/node_modules
COPY game-api/src ./src
COPY game-api/public ./public
EXPOSE 3003
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
RUN ln -s /app/game-api/node_modules /app/node_modules
COPY game-api/src ./src
COPY game-api/public ./public
EXPOSE 3003
CMD ["node", "src/index.js"]
