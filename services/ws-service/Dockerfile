FROM node:20-alpine AS base
WORKDIR /app
COPY services/ws-service/package.json .

FROM base AS development
RUN npm install
COPY services/ws-service/src ./src
COPY shared /shared
EXPOSE 3007
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY services/ws-service/src ./src
COPY shared /shared
EXPOSE 3007
CMD ["node", "src/index.js"]
