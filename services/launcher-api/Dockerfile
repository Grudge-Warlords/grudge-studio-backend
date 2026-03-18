FROM node:20-alpine AS base
WORKDIR /app
COPY services/launcher-api/package.json .

FROM base AS development
RUN npm install
COPY services/launcher-api/src ./src
COPY shared /shared
RUN ln -s /app/node_modules /shared/node_modules
EXPOSE 3006
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY services/launcher-api/src ./src
COPY shared /shared
RUN ln -s /app/node_modules /shared/node_modules
EXPOSE 3006
CMD ["node", "src/index.js"]
