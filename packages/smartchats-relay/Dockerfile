FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --omit=dev=false
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
