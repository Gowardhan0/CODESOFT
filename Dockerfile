FROM node:20-bookworm-slim
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
