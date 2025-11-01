#!/bin/bash
set -euo pipefail

# ==============================================================================
# IOTANA - SERVIDOR DE APROVISIONAMIENTO
# INSTALADOR AUTOMATIZADO EMPRESARIAL
# ==============================================================================
# Versión: 2.0.0
# Descripción: Script de instalación y configuración automatizada
# Licencia: Propietario
# Copyright (c) 2025 IOTANA - Todos los derechos reservados
# ==============================================================================

readonly IMAGE="ghcr.io/eugelocos/servidor-provisioning:latest"
readonly CONTAINER_NAME="servidor-provisioning"
readonly DEFAULT_PORT=15182
readonly LOG_FILE="instalacion_$(date +%Y%m%d_%H%M%S).log"

# Colores para output profesional
readonly COLOR_RESET='\033[0m'
readonly COLOR_INFO='\033[0;36m'
readonly COLOR_SUCCESS='\033[0;32m'
readonly COLOR_WARNING='\033[0;33m'
readonly COLOR_ERROR='\033[0;31m'
readonly COLOR_HEADER='\033[1;34m'

# ==============================================================================
# FUNCIONES AUXILIARES
# ==============================================================================

log_info() {
    echo -e "${COLOR_INFO}ℹ️  $1${COLOR_RESET}" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${COLOR_SUCCESS}✅ $1${COLOR_RESET}" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${COLOR_WARNING}⚠️  $1${COLOR_RESET}" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${COLOR_ERROR}❌ ERROR: $1${COLOR_RESET}" | tee -a "$LOG_FILE"
}

log_header() {
    echo -e "${COLOR_HEADER}$1${COLOR_RESET}" | tee -a "$LOG_FILE"
}

print_banner() {
    log_header "╔════════════════════════════════════════════════════════════════╗"
    log_header "║           IOTANA - SERVIDOR DE APROVISIONAMIENTO               ║"
    log_header "║              Instalador Automatizado v2.0.0                    ║"
    log_header "╚════════════════════════════════════════════════════════════════╝"
    echo ""
}

error_exit() {
    log_error "$1"
    log_info "Revise el archivo de log: $LOG_FILE"
    exit 1
}

check_root() {
    if [ "$EUID" -eq 0 ]; then
        log_warning "No se recomienda ejecutar este script como root directamente."
        read -p "¿Desea continuar de todos modos? (s/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Ss]$ ]]; then
            exit 1
        fi
    fi
}

# ==============================================================================
# VERIFICACIÓN DE REQUISITOS DEL SISTEMA
# ==============================================================================

check_system_requirements() {
    log_info "Verificando requisitos del sistema..."
    
    # Verificar memoria disponible
    local mem_available=$(free -m | awk 'NR==2{print $7}')
    if [ "$mem_available" -lt 512 ]; then
        log_warning "Memoria disponible baja: ${mem_available}MB (recomendado: >512MB)"
    fi
    
    # Verificar espacio en disco
    local disk_available=$(df -BG / | awk 'NR==2{print $4}' | sed 's/G//')
    if [ "$disk_available" -lt 2 ]; then
        log_warning "Espacio en disco bajo: ${disk_available}GB (recomendado: >2GB)"
    fi
    
    log_success "Verificación de requisitos completada"
}

# ==============================================================================
# INSTALACIÓN DE DOCKER
# ==============================================================================

install_docker() {
    log_info "Instalando Docker Engine..."
    
    if [ ! -f /etc/debian_version ] && [ ! -f /etc/redhat-release ]; then
        error_exit "Sistema operativo no soportado. Se requiere Ubuntu/Debian o RHEL/CentOS."
    fi
    
    # Instalación para Debian/Ubuntu
    if [ -f /etc/debian_version ]; then
        sudo apt-get update || error_exit "Fallo al actualizar repositorios"
        sudo apt-get install -y \
            ca-certificates \
            curl \
            gnupg \
            lsb-release || error_exit "Fallo al instalar dependencias"
        
        sudo mkdir -p /etc/apt/keyrings
        
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
            sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg || \
            error_exit "Fallo al agregar clave GPG de Docker"
        
        echo \
            "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
            $(lsb_release -cs) stable" | \
            sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        sudo apt-get update || error_exit "Fallo al actualizar repositorios"
        sudo apt-get install -y \
            docker-ce \
            docker-ce-cli \
            containerd.io \
            docker-buildx-plugin \
            docker-compose-plugin || error_exit "Fallo al instalar Docker"
        
        sudo usermod -aG docker "$USER"
        
        log_success "Docker instalado correctamente"
        log_warning "Es necesario cerrar sesión y volver a iniciar para aplicar permisos de grupo"
        
        read -p "¿Desea continuar con la instalación actual? (S/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            log_info "Instalación pausada. Reinicie sesión y ejecute nuevamente el script."
            exit 0
        fi
    fi
}

# ==============================================================================
# CONFIGURACIÓN DEL ENTORNO
# ==============================================================================

setup_environment() {
    log_info "Configurando entorno de aplicación..."
    
    if [ ! -f ".env" ]; then
        log_info "Creando archivo de configuración .env..."
        
        read -p "Puerto para el servidor [$DEFAULT_PORT]: " USER_PORT
        PORT=${USER_PORT:-$DEFAULT_PORT}
        
        cat <<EOF > .env
# Configuración del Servidor de Aprovisionamiento
# Generado automáticamente: $(date)

PORT=$PORT
NODE_ENV=production
LOG_LEVEL=info

# Configuración de seguridad
RATE_LIMIT_ENABLED=true
CORS_ENABLED=true

# Configuración de reintentos
MAX_RETRIES=3
RETRY_DELAY=1000
EOF
        chmod 600 .env
        log_success "Archivo .env creado correctamente"
    else
        log_info "Archivo .env existente detectado, utilizando configuración actual"
    fi
    
    # Cargar variables
    set -a
    source .env
    set +a
    
    PORT=${PORT:-$DEFAULT_PORT}
}

# ==============================================================================
# GESTIÓN DE CONTENEDORES
# ==============================================================================

check_docker_service() {
    log_info "Verificando servicio Docker..."
    
    if ! sudo systemctl is-active --quiet docker; then
        log_warning "Docker no está en ejecución. Iniciando servicio..."
        sudo systemctl start docker || error_exit "No se pudo iniciar el servicio Docker"
    fi
    
    log_success "Servicio Docker activo"
}

pull_latest_image() {
    log_info "Descargando imagen del contenedor..."
    log_info "Imagen: $IMAGE"
    
    docker pull "$IMAGE" || error_exit "Fallo al descargar la imagen del contenedor"
    
    log_success "Imagen descargada correctamente"
}

manage_existing_container() {
    if [ "$(docker ps -aq -f name="$CONTAINER_NAME")" ]; then
        log_warning "Contenedor existente detectado: $CONTAINER_NAME"
        
        if [ "$(docker ps -q -f name="$CONTAINER_NAME")" ]; then
            log_info "Deteniendo contenedor en ejecución..."
            docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
        fi
        
        log_info "Eliminando contenedor anterior..."
        docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
        
        log_success "Contenedor anterior removido"
    fi
}

start_container() {
    log_info "Iniciando servidor en puerto $PORT..."
    
    docker run -d \
        --name "$CONTAINER_NAME" \
        --env-file .env \
        -p "$PORT:$PORT" \
        --restart unless-stopped \
        --health-cmd="wget --no-verbose --tries=1 --spider http://localhost:$PORT/health || exit 1" \
        --health-interval=30s \
        --health-timeout=10s \
        --health-retries=3 \
        "$IMAGE" || error_exit "Fallo al iniciar el contenedor"
    
    log_success "Contenedor iniciado correctamente"
}

verify_deployment() {
    log_info "Verificando estado del despliegue..."
    
    sleep 5
    
    if [ "$(docker ps -q -f name="$CONTAINER_NAME")" ]; then
        log_success "Contenedor en ejecución"
        
        # Verificar logs para errores críticos
        local logs=$(docker logs "$CONTAINER_NAME" 2>&1 | tail -n 20)
        if echo "$logs" | grep -qi "error\|fatal\|exception"; then
            log_warning "Se detectaron posibles errores en los logs del contenedor"
            log_info "Ejecute 'docker logs $CONTAINER_NAME' para más detalles"
        fi
    else
        error_exit "El contenedor no está en ejecución"
    fi
}

# ==============================================================================
# RESUMEN DE INSTALACIÓN
# ==============================================================================

get_server_ip() {
    # Intentar obtener la IP pública
    local public_ip=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "")
    
    # Obtener IP local
    local local_ip=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "localhost")
    
    if [ -n "$public_ip" ]; then
        echo "$public_ip"
    else
        echo "$local_ip"
    fi
}

print_summary() {
    local server_ip=$(get_server_ip)
    
    echo ""
    log_header "╔════════════════════════════════════════════════════════════════╗"
    log_header "║              INSTALACIÓN COMPLETADA EXITOSAMENTE               ║"
    log_header "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    log_success "INFORMACIÓN DEL DESPLIEGUE"
    log_success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_success "Empresa: IOTANA"
    log_success "Contenedor: $CONTAINER_NAME"
    log_success "Imagen: $IMAGE"
    log_success "Puerto: $PORT"
    echo ""
    log_info "ENDPOINTS DE LA API"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  📍 URL Local:"
    echo "     http://localhost:$PORT"
    echo ""
    echo "  📍 URL de Red:"
    echo "     http://$server_ip:$PORT"
    echo ""
    echo "  📍 Endpoints principales de la API:"
    echo "     • Health Check:    http://$server_ip:$PORT/health"
    echo "     • API Base:        http://$server_ip:$PORT/api"
    echo "     • Documentación:   http://$server_ip:$PORT/docs"
    echo "     • Estado:          http://$server_ip:$PORT/status"
    echo ""
    log_info "COMANDOS ÚTILES"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  • Ver logs:             docker logs $CONTAINER_NAME"
    echo "  • Logs en tiempo real:  docker logs -f $CONTAINER_NAME"
    echo "  • Detener servidor:     docker stop $CONTAINER_NAME"
    echo "  • Iniciar servidor:     docker start $CONTAINER_NAME"
    echo "  • Reiniciar servidor:   docker restart $CONTAINER_NAME"
    echo "  • Estado del contenedor: docker ps -f name=$CONTAINER_NAME"
    echo "  • Inspeccionar:         docker inspect $CONTAINER_NAME"
    echo ""
    log_info "PRUEBA RÁPIDA DE CONECTIVIDAD"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  curl http://localhost:$PORT/health"
    echo ""
    log_warning "NOTA: Si accede desde otra máquina, asegúrese de que el puerto"
    log_warning "$PORT esté abierto en el firewall del servidor."
    echo ""
    log_info "Log de instalación: $LOG_FILE"
    log_info "Soporte técnico IOTANA: soporte@iotana.com"
    echo ""
}

# ==============================================================================
# FUNCIÓN PRINCIPAL
# ==============================================================================

main() {
    print_banner
    check_root
    
    # Ajustar permisos del script
    if [ ! -x "$0" ]; then
        log_info "Ajustando permisos de ejecución..."
        chmod +x "$0"
    fi
    
    check_system_requirements
    
    # Verificar Docker
    if ! command -v docker >/dev/null 2>&1; then
        log_warning "Docker no detectado en el sistema"
        install_docker
    else
        log_success "Docker detectado: $(docker --version)"
    fi
    
    check_docker_service
    setup_environment
    pull_latest_image
    manage_existing_container
    start_container
    verify_deployment
    print_summary
}

# ==============================================================================
# EJECUCIÓN
# ==============================================================================

main "$@"
