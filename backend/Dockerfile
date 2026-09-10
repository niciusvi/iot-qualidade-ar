# ============================================================================
# Backend School Air — Node.js 22 (Alpine)
# Imagem stateless: todo o estado vive no PostgreSQL (12-factor).
# A mesma imagem roda no Portainer residencial, no Azure Container Apps
# ou no AWS ECS — muda apenas a variável de ambiente DATABASE_URL.
# ============================================================================
FROM node:22-alpine

WORKDIR /app

# Instala dependências primeiro (camada cacheável)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copia o código
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "src/server.js"]
