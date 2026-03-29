FROM node:20-alpine AS base
WORKDIR /app/grudge-id
COPY services/grudge-id/package.json ./
COPY shared /app/shared
WORKDIR /app/shared
RUN npm install --omit=dev
WORKDIR /app/grudge-id

FROM base AS development
RUN npm install
RUN ln -s /app/grudge-id/node_modules /app/node_modules
COPY services/grudge-id/src ./src
COPY services/grudge-id/public ./public
EXPOSE 3001
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
RUN ln -s /app/grudge-id/node_modules /app/node_modules
COPY services/grudge-id/src ./src
COPY services/grudge-id/public ./public
EXPOSE 3001
CMD ["node", "src/index.js"]
