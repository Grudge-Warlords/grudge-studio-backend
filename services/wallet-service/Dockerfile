FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++
WORKDIR /app/wallet-service
COPY wallet-service/package.json .
COPY shared /app/shared

FROM base AS development
RUN npm install
COPY wallet-service/src ./src
EXPOSE 3002
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY wallet-service/src ./src
EXPOSE 3002
CMD ["node", "src/index.js"]
