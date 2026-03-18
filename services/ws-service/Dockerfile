FROM node:20-alpine AS base
WORKDIR /app/ws-service
COPY ws-service/package.json .
COPY shared /app/shared

FROM base AS development
RUN npm install
COPY ws-service/src ./src
EXPOSE 3007
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY ws-service/src ./src
EXPOSE 3007
CMD ["node", "src/index.js"]
