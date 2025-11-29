# TempLogger Pro v2.0

## Quick Start

### Development
```bash
# Instalar dependencias
npm install
cd frontend && npm install && cd ..

# Ejecutar backend y frontend
npm run dev:all

# O por separado:
npm run dev          # Backend en puerto 15182
npm run frontend:dev # Frontend en puerto 5173
```

### Production
```bash
# Build
npm run build
npm run frontend:build

# Run
npm start
```

### Docker
```bash
docker-compose up -d
```

## API Endpoints

### v1 (Existentes)
- POST /api/v1/devices/provision - Provisioning de dispositivos
- GET /api/v1/devices - Listar dispositivos
- GET /api/v1/customers - Listar clientes

### v2 (Nuevos)
- GET/POST/PUT/DELETE /api/v2/products - Gestión de productos
- GET/POST /api/v2/templates - Templates de provisioning
- GET /api/v2/analytics/real-time - Métricas en tiempo real
- GET /api/v2/system/status - Estado del sistema

## Testing
```bash
npm run test:api
```

## Backup
```bash
# Manual
npm run snapshot

# Automático (cada 5 minutos)
# Los snapshots se guardan en data/snapshots/

# Crear backup completo
./scripts/backup.sh

# Restaurar backup
./scripts/restore.sh backups/20240101_120000.tar.gz
```

## Monitoreo

Acceder a:
- Backend: http://localhost:15182
- Frontend: http://localhost:5173
- Health: http://localhost:15182/api/health
- Stats: http://localhost:15182/api/v1/stats
