#!/bin/bash

# Crear backup de datos
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/$DATE"

mkdir -p "$BACKUP_DIR"

# Copiar snapshots y logs
cp -r data/snapshots "$BACKUP_DIR/"
cp -r data/logs "$BACKUP_DIR/"

# Comprimir
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

echo "Backup created: $BACKUP_DIR.tar.gz"

# Limpiar backups antiguos (mantener últimos 7)
ls -t backups/*.tar.gz | tail -n +8 | xargs -r rm

echo "Old backups cleaned"
