# Hichki: one container with the server and the built web page.

# 1. Build the web page.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY web ./web
RUN npm run build

# 2. Run the server, which also serves the built page.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY server ./server
COPY --from=build /app/dist/web ./dist/web
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/index.ts"]
