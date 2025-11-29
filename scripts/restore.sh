#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: ./restore.sh <backup-file.tar.gz>"
    exit 1
fi

BACKUP_FILE=$1

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found"
    exit 1
fi

# Extraer backup
TEMP_DIR=$(mktemp -d)
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Restaurar datos
rm -rf data/snapshots data/logs
cp -r "$TEMP_DIR"/*/snapshots data/
cp -r "$TEMP_DIR"/*/logs data/

rm -rf "$TEMP_DIR"

echo "Backup restored successfully"
echo "Please restart the server"
