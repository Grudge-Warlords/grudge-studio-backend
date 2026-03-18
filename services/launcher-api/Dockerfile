FROM node:20-alpine AS base
WORKDIR /app/launcher-api
COPY launcher-api/package.json .
COPY shared /app/shared

FROM base AS development
RUN npm install
RUN ln -s /app/launcher-api/node_modules /app/node_modules
COPY launcher-api/src ./src
EXPOSE 3006
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
RUN ln -s /app/launcher-api/node_modules /app/node_modules
COPY launcher-api/src ./src
EXPOSE 3006
CMD ["node", "src/index.js"]
