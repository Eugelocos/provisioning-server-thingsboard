# ===== Etapa 1: Build =====
FROM node:22-alpine AS builder

WORKDIR /app

# Copiamos package.json y package-lock.json
COPY package*.json ./

# Instalamos TODAS las dependencias, incluidas devDependencies
RUN npm ci

# Copiamos el resto del código
COPY . .

# Compilamos TypeScript a JS
RUN npm run build

# ===== Etapa 2: Imagen final =====
FROM node:22-alpine

WORKDIR /app

# Solo instalamos dependencias de producción
COPY package*.json ./
RUN npm ci --production

# Copiamos los archivos compilados desde la etapa builder
COPY --from=builder /app/dist ./dist

# Declaramos variables configurables
ENV PORT=15182
ENV NODE_ENV=production

# Exponemos el puerto (Docker no cambia el mapeo automáticamente,
# pero esto documenta internamente el puerto del contenedor)
EXPOSE $PORT

# Comando para correr el servidor
CMD ["node", "dist/index.js"]
