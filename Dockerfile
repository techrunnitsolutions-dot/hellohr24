# Works on Render, Railway, Fly.io or any Docker host. Mount a persistent volume at /data - that is where all databases live.
FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production DATA_DIR=/data SEED_DEMO=0 PORT=3000
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
