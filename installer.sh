#!/usr/bin/env bash
set -e

echo ""
echo "🚀 Instalador del servidor de provisioning (Eugelocos)"
echo "-----------------------------------------------------"

# 1️⃣ Verificar que Docker esté instalado
if ! command -v docker &> /dev/null
then
    echo "❌ Docker no está instalado. Por favor instalalo primero."
    echo "   👉 https://docs.docker.com/get-docker/"
    exit 1
fi

# 2️⃣ Pedir variables al usuario (con valores por defecto)
echo ""
read -p "🌐 Puerto para exponer el servidor [15182]: " SERVER_PORT
SERVER_PORT=${SERVER_PORT:-15182}

read -p "📁 Ruta para archivos persistentes (por ej. /opt/provisioning-data) [./data]: " DATA_PATH
DATA_PATH=${DATA_PATH:-./data}

# Crear directorio si no existe
mkdir -p "$DATA_PATH"

# 3️⃣ Crear archivo .env (opcional)
ENV_FILE=".env"
echo ""
echo "🧩 Generando archivo .env..."
cat > $ENV_FILE <<EOF
# Variables del servidor de provisioning
PORT=$SERVER_PORT
DATA_PATH=$DATA_PATH
NODE_ENV=production
EOF

echo "✅ Archivo .env generado:"
cat $ENV_FILE
echo ""

# 4️⃣ Descargar y correr el contenedor
echo "🐳 Descargando imagen desde GitHub Container Registry..."
docker pull ghcr.io/eugelocos/servidor-provisioning:latest

echo ""
echo "🚢 Iniciando contenedor..."
docker run -d \
  --name servidor-provisioning \
  --env-file .env \
  -p ${SERVER_PORT}:15182 \
  -v ${DATA_PATH}:/app/data \
  ghcr.io/eugelocos/servidor-provisioning:latest

echo ""
echo "✅ Servidor iniciado correctamente."
echo "👉 Accedé en: http://localhost:${SERVER_PORT}"
echo ""
echo "📦 Contenedor: servidor-provisioning"
echo "🗃️ Datos persistentes en: ${DATA_PATH}"
