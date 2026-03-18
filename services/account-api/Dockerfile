FROM node:20-alpine AS base
WORKDIR /app
COPY services/account-api/package.json .

FROM base AS development
RUN npm install
COPY services/account-api/src ./src
COPY shared /shared
EXPOSE 3005
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY services/account-api/src ./src
COPY shared /shared
EXPOSE 3005
CMD ["node", "src/index.js"]
