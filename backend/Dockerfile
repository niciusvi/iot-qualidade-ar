# ============================================================================
# Backend School Air — Node.js 22 (Alpine)
# Contexto de build = RAIZ do repositório (ver docker-compose.yml), para o
# backend embarcar o fonte do firmware e gerar o sala-N.ino pré-configurado.
# Stateless: todo o estado vive no PostgreSQL (12-factor).
# ============================================================================
FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY backend/src ./src
COPY esp32 ./esp32

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "src/server.js"]
