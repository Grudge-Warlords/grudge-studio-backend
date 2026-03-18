FROM node:20-alpine AS base
WORKDIR /app
COPY services/grudge-id/package.json .

FROM base AS development
RUN npm install
COPY services/grudge-id/src ./src
COPY shared /shared
EXPOSE 3001
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY services/grudge-id/src ./src
COPY shared /shared
EXPOSE 3001
CMD ["node", "src/index.js"]
