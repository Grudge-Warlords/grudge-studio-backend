FROM node:20-alpine AS base
WORKDIR /app
COPY package.json .

FROM base AS development
RUN npm install
COPY src ./src
EXPOSE 3004
CMD ["npx", "nodemon", "src/index.js"]

FROM base AS production
RUN npm install --omit=dev
COPY src ./src
EXPOSE 3004
CMD ["node", "src/index.js"]
