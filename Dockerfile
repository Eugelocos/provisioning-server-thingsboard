# Usamos Node LTS
FROM node:22-slim

# Carpeta de trabajo
WORKDIR /app

# Copiamos package.json y package-lock.json
COPY package*.json ./
COPY tsconfig.json ./

# Instalamos TODAS las dependencias (incluyendo TypeScript)
RUN npm ci

# Copiamos el resto del código
COPY . .

# Compilamos TypeScript a JS
RUN npm run build

# Instalamos SOLO dependencias de producción para la imagen final
RUN npm ci --production

# Exponemos puerto
EXPOSE 15182

# Comando para correr el servidor
CMD ["node", "dist/index.js"]
