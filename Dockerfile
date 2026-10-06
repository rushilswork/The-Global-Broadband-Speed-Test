FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data && chown -R node:node data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
