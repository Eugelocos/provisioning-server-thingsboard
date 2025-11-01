# Usamos Node LTS
FROM node:22-alpine

# Carpeta de trabajo
WORKDIR /app

# Copiamos package.json y package-lock.json
COPY package*.json ./

# Instalamos dependencias
RUN npm ci --production

# Copiamos el resto del código
COPY . .

# Compilamos TypeScript a JS
RUN npx tsc

# Exponemos puerto
EXPOSE 15182

# Comando para correr el servidor
CMD ["node", "dist/index.js"]
