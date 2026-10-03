FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs index.html script.js styles.css ./
COPY assets ./assets
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
