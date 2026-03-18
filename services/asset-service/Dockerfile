FROM node:20-alpine AS base
WORKDIR /app/asset-service
COPY asset-service/package.json .
COPY shared /app/shared

FROM base AS development
RUN npm install
COPY asset-service/src ./src
EXPOSE 3008
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY asset-service/src ./src
EXPOSE 3008
CMD ["node", "src/index.js"]
