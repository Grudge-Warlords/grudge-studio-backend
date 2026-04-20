FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine

# mysqldump for database operations (replica may need dump/restore)
RUN apk add --no-cache mysql-client gzip curl

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ ./dist/

EXPOSE 4000

CMD ["node", "dist/index.js"]
