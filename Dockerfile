FROM node:20-slim
WORKDIR /app
COPY package*.json ./
COPY . .
RUN npm ci && npm run build
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
