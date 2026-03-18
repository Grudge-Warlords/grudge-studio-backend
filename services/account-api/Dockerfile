FROM node:20-alpine AS base
WORKDIR /app/account-api
COPY account-api/package.json .
COPY shared /app/shared

FROM base AS development
RUN npm install
RUN ln -s /app/account-api/node_modules /app/node_modules
COPY account-api/src ./src
EXPOSE 3005
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
RUN ln -s /app/account-api/node_modules /app/node_modules
COPY account-api/src ./src
EXPOSE 3005
CMD ["node", "src/index.js"]
