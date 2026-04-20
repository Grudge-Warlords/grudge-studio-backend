FROM node:22-alpine AS base
WORKDIR /app/ws-service
COPY ws-service/package.json .
COPY shared /app/shared
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/ws-service

FROM base AS development
RUN npm install
RUN ln -s /app/ws-service/node_modules /app/node_modules
COPY ws-service/src ./src
EXPOSE 3007
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
RUN ln -s /app/ws-service/node_modules /app/node_modules
COPY ws-service/src ./src
EXPOSE 3007
CMD ["node", "src/index.js"]
