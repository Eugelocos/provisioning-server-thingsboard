// backend-extensions.ts
// Nuevos módulos para agregar al index.tsx existente

import { promises as fs } from 'fs';
import { join } from 'path';

// ================================
// TIPOS Y INTERFACES
// ================================

interface DynamicSpecs {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'select';
    label: string;
    required?: boolean;
    options?: string[];
    defaultValue?: any;
  };
}

interface Product {
  id: string;
  name: string;
  type: 'sensor' | 'gateway' | 'actuator';
  specifications: DynamicSpecs;
  provisioningTemplate: string; // ID del template
  created: number;
  updated: number;
  enabled: boolean;
}

interface ProvisioningTemplate {
  id: string;
  name: string;
  description: string;
  fields: {
    [key: string]: {
      type: 'text' | 'email' | 'number' | 'select';
      label: string;
      required: boolean;
      validation?: string;
      options?: string[];
    };
  };
  deviceProfileId?: string;
  dashboardTemplateId?: string;
  created: number;
  updated: number;
}

interface SystemSnapshot {
  products: Map<string, Product>;
  templates: Map<string, ProvisioningTemplate>;
  timestamp: number;
  version: string;
}

// ================================
// PERSISTENCIA EN ARCHIVOS
// ================================

class FileSystemPersistence {
  private dataDir = '../data';
  
  constructor() {
    this.ensureDataDir();
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(join(this.dataDir, 'snapshots'), { recursive: true });
      await fs.mkdir(join(this.dataDir, 'logs'), { recursive: true });
    } catch (error) {
      console.error('Error creating data directories:', error);
    }
  }

  async saveSnapshot(
    products: Map<string, Product>,
    templates: Map<string, ProvisioningTemplate>
  ): Promise<void> {
    const snapshot: any = {
      products: Array.from(products.entries()),
      templates: Array.from(templates.entries()),
      timestamp: Date.now(),
      version: '2.0.0',
    };

    const filename = join(
      this.dataDir,
      'snapshots',
      `snapshot-${Date.now()}.json`
    );

    await fs.writeFile(filename, JSON.stringify(snapshot, null, 2));
    
    // Mantener solo los últimos 10 snapshots
    await this.cleanOldSnapshots();
  }

  async loadLatestSnapshot(): Promise<{
    products: Map<string, Product>;
    templates: Map<string, ProvisioningTemplate>;
  } | null> {
    try {
      const snapshotsDir = join(this.dataDir, 'snapshots');
      const files = await fs.readdir(snapshotsDir);
      
      if (files.length === 0) return null;

      // Ordenar por fecha (más reciente primero)
      const sortedFiles = files
        .filter(f => f.startsWith('snapshot-'))
        .sort()
        .reverse();

      if (sortedFiles.length === 0) return null;

      const latestFile = join(snapshotsDir, sortedFiles[0]);
      const content = await fs.readFile(latestFile, 'utf-8');
      const data = JSON.parse(content);

      return {
        products: new Map(data.products),
        templates: new Map(data.templates),
      };
    } catch (error) {
      console.error('Error loading snapshot:', error);
      return null;
    }
  }

  private async cleanOldSnapshots(): Promise<void> {
    try {
      const snapshotsDir = join(this.dataDir, 'snapshots');
      const files = await fs.readdir(snapshotsDir);
      
      const sortedFiles = files
        .filter(f => f.startsWith('snapshot-'))
        .sort()
        .reverse();

      // Eliminar snapshots antiguos (mantener últimos 10)
      if (sortedFiles.length > 10) {
        const toDelete = sortedFiles.slice(10);
        await Promise.all(
          toDelete.map(f => fs.unlink(join(snapshotsDir, f)))
        );
      }
    } catch (error) {
      console.error('Error cleaning snapshots:', error);
    }
  }

  async appendLog(event: any): Promise<void> {
    const logFile = join(
      this.dataDir,
      'logs',
      `events-${new Date().toISOString().split('T')[0]}.json`
    );

    const logEntry = JSON.stringify({
      ...event,
      timestamp: Date.now(),
    }) + '\n';

    await fs.appendFile(logFile, logEntry);
  }
}

// ================================
// GESTOR DE PRODUCTOS DINÁMICOS
// ================================

class ProductManager {
  private products = new Map<string, Product>();
  private persistence: FileSystemPersistence;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(persistence: FileSystemPersistence) {
    this.persistence = persistence;
    this.initializeDefaultProducts();
    this.startAutoSave();
  }

  async initialize(): Promise<void> {
    const snapshot = await this.persistence.loadLatestSnapshot();
    if (snapshot) {
      this.products = snapshot.products;
      console.log(`✅ Loaded ${this.products.size} products from snapshot`);
    }
  }

  private initializeDefaultProducts(): void {
    // Producto por defecto: TempLogger
    this.createProduct({
      name: 'TempLogger Pro',
      type: 'sensor',
      specifications: {
        serialNumber: {
          type: 'string',
          label: 'Número de Serie',
          required: true,
        },
        sensorName: {
          type: 'string',
          label: 'Nombre del Sensor',
          required: true,
        },
        productName: {
          type: 'string',
          label: 'Nombre del Producto',
          defaultValue: 'TempLogger',
        },
      },
      provisioningTemplate: 'default',
    });
  }

  createProduct(config: {
    name: string;
    type: 'sensor' | 'gateway' | 'actuator';
    specifications: DynamicSpecs;
    provisioningTemplate: string;
  }): Product {
    const id = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const product: Product = {
      id,
      name: config.name,
      type: config.type,
      specifications: config.specifications,
      provisioningTemplate: config.provisioningTemplate,
      created: Date.now(),
      updated: Date.now(),
      enabled: true,
    };

    this.products.set(id, product);
    
    this.persistence.appendLog({
      type: 'product_created',
      productId: id,
      productName: config.name,
    });

    return product;
  }

  getProduct(id: string): Product | null {
    return this.products.get(id) || null;
  }

  updateProduct(id: string, updates: Partial<Product>): Product | null {
    const product = this.products.get(id);
    if (!product) return null;

    const updated = {
      ...product,
      ...updates,
      id, // No permitir cambiar ID
      updated: Date.now(),
    };

    this.products.set(id, updated);
    
    this.persistence.appendLog({
      type: 'product_updated',
      productId: id,
      updates,
    });

    return updated;
  }

  listProducts(filters?: {
    type?: string;
    enabled?: boolean;
    search?: string;
  }): Product[] {
    let products = Array.from(this.products.values());

    if (filters?.type) {
      products = products.filter(p => p.type === filters.type);
    }

    if (filters?.enabled !== undefined) {
      products = products.filter(p => p.enabled === filters.enabled);
    }

    if (filters?.search) {
      const search = filters.search.toLowerCase();
      products = products.filter(p => 
        p.name.toLowerCase().includes(search)
      );
    }

    return products;
  }

  deleteProduct(id: string): boolean {
    const deleted = this.products.delete(id);
    
    if (deleted) {
      this.persistence.appendLog({
        type: 'product_deleted',
        productId: id,
      });
    }

    return deleted;
  }

  private startAutoSave(): void {
    // Auto-guardar cada 5 minutos
    this.autoSaveInterval = setInterval(async () => {
      await this.saveSnapshot();
    }, 5 * 60 * 1000);
  }

  async saveSnapshot(): Promise<void> {
    const templates = templateEngine.getAllTemplates();
    await this.persistence.saveSnapshot(this.products, templates);
    console.log('📸 Snapshot saved');
  }

  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
  }
}

// ================================
// MOTOR DE PLANTILLAS
// ================================

class TemplateEngine {
  private templates = new Map<string, ProvisioningTemplate>();
  private persistence: FileSystemPersistence;

  constructor(persistence: FileSystemPersistence) {
    this.persistence = persistence;
    this.initializeDefaultTemplates();
  }

  async initialize(): Promise<void> {
    const snapshot = await this.persistence.loadLatestSnapshot();
    if (snapshot) {
      this.templates = snapshot.templates;
      console.log(`✅ Loaded ${this.templates.size} templates from snapshot`);
    }
  }

  private initializeDefaultTemplates(): void {
    this.createTemplate('default', {
      name: 'Provisioning Estándar',
      description: 'Template por defecto para provisioning básico',
      fields: {
        serialNumber: {
          type: 'text',
          label: 'Número de Serie',
          required: true,
          validation: '^[a-zA-Z0-9_-]{3,50}$',
        },
        sensorName: {
          type: 'text',
          label: 'Nombre del Sensor',
          required: true,
        },
        customerName: {
          type: 'text',
          label: 'Nombre del Cliente',
          required: false,
        },
        userEmail: {
          type: 'email',
          label: 'Email del Usuario',
          required: false,
        },
        createUser: {
          type: 'select',
          label: '¿Crear Usuario?',
          required: false,
          options: ['true', 'false'],
        },
      },
    });
  }

  createTemplate(id: string, config: {
    name: string;
    description: string;
    fields: ProvisioningTemplate['fields'];
    deviceProfileId?: string;
    dashboardTemplateId?: string;
  }): ProvisioningTemplate {
    const template: ProvisioningTemplate = {
      id,
      name: config.name,
      description: config.description,
      fields: config.fields,
      deviceProfileId: config.deviceProfileId,
      dashboardTemplateId: config.dashboardTemplateId,
      created: Date.now(),
      updated: Date.now(),
    };

    this.templates.set(id, template);
    
    this.persistence.appendLog({
      type: 'template_created',
      templateId: id,
      templateName: config.name,
    });

    return template;
  }

  getTemplate(id: string): ProvisioningTemplate | null {
    return this.templates.get(id) || null;
  }

  updateTemplate(id: string, updates: Partial<ProvisioningTemplate>): ProvisioningTemplate | null {
    const template = this.templates.get(id);
    if (!template) return null;

    const updated = {
      ...template,
      ...updates,
      id,
      updated: Date.now(),
    };

    this.templates.set(id, updated);
    return updated;
  }

  listTemplates(): ProvisioningTemplate[] {
    return Array.from(this.templates.values());
  }

  validateProvisioningData(templateId: string, data: any): {
    valid: boolean;
    errors: string[];
  } {
    const template = this.templates.get(templateId);
    if (!template) {
      return { valid: false, errors: ['Template not found'] };
    }

    const errors: string[] = [];

    for (const [fieldName, fieldConfig] of Object.entries(template.fields)) {
      const value = data[fieldName];

      // Validar campos requeridos
      if (fieldConfig.required && !value) {
        errors.push(`${fieldConfig.label} es requerido`);
        continue;
      }

      if (!value) continue; // Campo opcional sin valor

      // Validar tipos
      if (fieldConfig.type === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${fieldConfig.label} debe ser un email válido`);
        }
      }

      if (fieldConfig.type === 'number') {
        if (isNaN(Number(value))) {
          errors.push(`${fieldConfig.label} debe ser un número`);
        }
      }

      // Validar regex personalizado
      if (fieldConfig.validation) {
        const regex = new RegExp(fieldConfig.validation);
        if (!regex.test(value)) {
          errors.push(`${fieldConfig.label} no cumple el formato requerido`);
        }
      }

      // Validar opciones
      if (fieldConfig.options && !fieldConfig.options.includes(value)) {
        errors.push(`${fieldConfig.label} debe ser una de: ${fieldConfig.options.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getAllTemplates(): Map<string, ProvisioningTemplate> {
    return this.templates;
  }

  deleteTemplate(id: string): boolean {
    if (id === 'default') {
      return false; // No permitir eliminar template por defecto
    }
    return this.templates.delete(id);
  }
}

// ================================
// ANALYTICS EN TIEMPO REAL
// ================================

interface SystemMetrics {
  provisioning: {
    total: number;
    successful: number;
    failed: number;
    avgTime: number;
  };
  devices: {
    total: number;
    online: number;
    offline: number;
  };
  customers: {
    total: number;
    active: number;
  };
  cache: {
    hitRate: number;
    size: number;
  };
}

class AnalyticsEngine {
  private events: Array<{
    type: string;
    timestamp: number;
    data: any;
  }> = [];
  
  private readonly maxEvents = 10000;

  trackEvent(event: { type: string; data: any }): void {
    this.events.push({
      ...event,
      timestamp: Date.now(),
    });

    // Limpiar eventos antiguos
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  getRealTimeMetrics(): SystemMetrics {
    const now = Date.now();
    const lastHour = now - 60 * 60 * 1000;
    
    const recentEvents = this.events.filter(e => e.timestamp > lastHour);
    
    const provisioningEvents = recentEvents.filter(
      e => e.type === 'provisioning_complete' || e.type === 'provisioning_failed'
    );

    const successful = provisioningEvents.filter(
      e => e.type === 'provisioning_complete'
    ).length;

    const failed = provisioningEvents.filter(
      e => e.type === 'provisioning_failed'
    ).length;

    const avgTime = provisioningEvents.length > 0
      ? provisioningEvents.reduce((sum, e) => sum + (e.data.processingTime || 0), 0) / provisioningEvents.length
      : 0;

    return {
      provisioning: {
        total: provisioningEvents.length,
        successful,
        failed,
        avgTime: Math.round(avgTime),
      },
      devices: {
        total: 0, // Se actualizaría con datos reales
        online: 0,
        offline: 0,
      },
      customers: {
        total: 0,
        active: 0,
      },
      cache: {
        hitRate: 0,
        size: 0,
      },
    };
  }

  generateInsights(): string[] {
    const metrics = this.getRealTimeMetrics();
    const insights: string[] = [];

    if (metrics.provisioning.failed > metrics.provisioning.successful * 0.1) {
      insights.push('⚠️ Tasa de fallos elevada en provisioning');
    }

    if (metrics.provisioning.avgTime > 5000) {
      insights.push('⚡ Tiempo de provisioning alto, considerar optimización');
    }

    if (metrics.cache.hitRate < 50) {
      insights.push('📊 Tasa de cache baja, revisar estrategia de cacheo');
    }

    return insights;
  }

  getEventHistory(type?: string, limit = 100): any[] {
    let events = this.events;
    
    if (type) {
      events = events.filter(e => e.type === type);
    }

    return events.slice(-limit).reverse();
  }
}

// ================================
// INICIALIZACIÓN
// ================================

const persistence = new FileSystemPersistence();
const productManager = new ProductManager(persistence);
const templateEngine = new TemplateEngine(persistence);
const analyticsEngine = new AnalyticsEngine();

// Inicializar desde snapshots
(async () => {
  await productManager.initialize();
  await templateEngine.initialize();
  console.log('✅ Product and Template systems initialized');
})();

export {
  ProductManager,
  TemplateEngine,
  AnalyticsEngine,
  FileSystemPersistence,
  productManager,
  templateEngine,
  analyticsEngine,
  persistence,
};

export type {
  Product,
  ProvisioningTemplate,
  DynamicSpecs,
  SystemMetrics,
};
