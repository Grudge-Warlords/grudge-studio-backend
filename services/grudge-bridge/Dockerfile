FROM node:20-alpine

# mysqldump for database operations
RUN apk add --no-cache mysql-client gzip curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

EXPOSE 4000

CMD ["node", "dist/index.js"]
