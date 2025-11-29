// api-routes-v2.ts
// Agregar estos endpoints al app de Hono en index.tsx

import { Hono } from 'hono';
import { 
  productManager, 
  templateEngine, 
  analyticsEngine 
} from './backend-extensions';

// ================================
// PRODUCTOS DINÁMICOS
// ================================

export function registerProductRoutes(app: Hono) {
  // Crear producto
  app.post('/api/v2/products', async (c) => {
    try {
      const body = await c.req.json();
      
      const { name, type, specifications, provisioningTemplate } = body;

      if (!name || !type || !specifications) {
        return c.json({
          success: false,
          message: 'name, type y specifications son requeridos',
        }, 400);
      }

      const product = productManager.createProduct({
        name,
        type,
        specifications,
        provisioningTemplate: provisioningTemplate || 'default',
      });

      analyticsEngine.trackEvent({
        type: 'product_created',
        data: { productId: product.id, productName: product.name },
      });

      return c.json({
        success: true,
        product,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error creating product',
      }, 500);
    }
  });

  // Listar productos
  app.get('/api/v2/products', async (c) => {
    try {
      const type = c.req.query('type');
      const enabled = c.req.query('enabled');
      const search = c.req.query('search');

      const filters: any = {};
      if (type) filters.type = type;
      if (enabled !== undefined) filters.enabled = enabled === 'true';
      if (search) filters.search = search;

      const products = productManager.listProducts(filters);

      return c.json({
        success: true,
        count: products.length,
        products,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error listing products',
      }, 500);
    }
  });

  // Obtener producto específico
  app.get('/api/v2/products/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const product = productManager.getProduct(id);

      if (!product) {
        return c.json({
          success: false,
          message: 'Product not found',
        }, 404);
      }

      return c.json({
        success: true,
        product,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error getting product',
      }, 500);
    }
  });

  // Actualizar producto
  app.put('/api/v2/products/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const updates = await c.req.json();

      const product = productManager.updateProduct(id, updates);

      if (!product) {
        return c.json({
          success: false,
          message: 'Product not found',
        }, 404);
      }

      analyticsEngine.trackEvent({
        type: 'product_updated',
        data: { productId: id },
      });

      return c.json({
        success: true,
        product,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error updating product',
      }, 500);
    }
  });

  // Eliminar producto
  app.delete('/api/v2/products/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const deleted = productManager.deleteProduct(id);

      if (!deleted) {
        return c.json({
          success: false,
          message: 'Product not found',
        }, 404);
      }

      analyticsEngine.trackEvent({
        type: 'product_deleted',
        data: { productId: id },
      });

      return c.json({
        success: true,
        message: 'Product deleted successfully',
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error deleting product',
      }, 500);
    }
  });
}

// ================================
// TEMPLATES DE PROVISIONING
// ================================

export function registerTemplateRoutes(app: Hono) {
  // Crear template
  app.post('/api/v2/templates', async (c) => {
    try {
      const body = await c.req.json();
      
      const { id, name, description, fields, deviceProfileId, dashboardTemplateId } = body;

      if (!id || !name || !fields) {
        return c.json({
          success: false,
          message: 'id, name y fields son requeridos',
        }, 400);
      }

      const template = templateEngine.createTemplate(id, {
        name,
        description: description || '',
        fields,
        deviceProfileId,
        dashboardTemplateId,
      });

      return c.json({
        success: true,
        template,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error creating template',
      }, 500);
    }
  });

  // Listar templates
  app.get('/api/v2/templates', async (c) => {
    try {
      const templates = templateEngine.listTemplates();

      return c.json({
        success: true,
        count: templates.length,
        templates,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error listing templates',
      }, 500);
    }
  });

  // Obtener template específico
  app.get('/api/v2/templates/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const template = templateEngine.getTemplate(id);

      if (!template) {
        return c.json({
          success: false,
          message: 'Template not found',
        }, 404);
      }

      return c.json({
        success: true,
        template,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error getting template',
      }, 500);
    }
  });

  // Validar datos de provisioning
  app.post('/api/v2/templates/:id/validate', async (c) => {
    try {
      const id = c.req.param('id');
      const data = await c.req.json();

      const validation = templateEngine.validateProvisioningData(id, data);

      return c.json({
        success: validation.valid,
        ...validation,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error validating data',
      }, 500);
    }
  });

  // Actualizar template
  app.put('/api/v2/templates/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const updates = await c.req.json();

      const template = templateEngine.updateTemplate(id, updates);

      if (!template) {
        return c.json({
          success: false,
          message: 'Template not found',
        }, 404);
      }

      return c.json({
        success: true,
        template,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error updating template',
      }, 500);
    }
  });

  // Eliminar template
  app.delete('/api/v2/templates/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const deleted = templateEngine.deleteTemplate(id);

      if (!deleted) {
        return c.json({
          success: false,
          message: 'Template not found or cannot be deleted',
        }, 404);
      }

      return c.json({
        success: true,
        message: 'Template deleted successfully',
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error deleting template',
      }, 500);
    }
  });
}

// ================================
// ANALYTICS Y MÉTRICAS
// ================================

export function registerAnalyticsRoutes(app: Hono) {
  // Métricas en tiempo real
  app.get('/api/v2/analytics/real-time', async (c) => {
    try {
      const metrics = analyticsEngine.getRealTimeMetrics();

      return c.json({
        success: true,
        metrics,
        timestamp: Date.now(),
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error getting metrics',
      }, 500);
    }
  });

  // Registrar evento
  app.post('/api/v2/analytics/events', async (c) => {
    try {
      const body = await c.req.json();
      const { type, data } = body;

      if (!type) {
        return c.json({
          success: false,
          message: 'type es requerido',
        }, 400);
      }

      analyticsEngine.trackEvent({ type, data });

      return c.json({
        success: true,
        message: 'Event tracked successfully',
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error tracking event',
      }, 500);
    }
  });

  // Insights automáticos
  app.get('/api/v2/analytics/insights', async (c) => {
    try {
      const insights = analyticsEngine.generateInsights();

      return c.json({
        success: true,
        insights,
        timestamp: Date.now(),
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error generating insights',
      }, 500);
    }
  });

  // Historial de eventos
  app.get('/api/v2/analytics/events/history', async (c) => {
    try {
      const type = c.req.query('type');
      const limit = parseInt(c.req.query('limit') || '100');

      const events = analyticsEngine.getEventHistory(type, limit);

      return c.json({
        success: true,
        count: events.length,
        events,
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error getting event history',
      }, 500);
    }
  });
}

// ================================
// SNAPSHOTS Y BACKUP
// ================================

export function registerSystemRoutes(app: Hono) {
  // Crear snapshot manual
  app.post('/api/v2/system/snapshot', async (c) => {
    try {
      await productManager.saveSnapshot();

      return c.json({
        success: true,
        message: 'Snapshot created successfully',
        timestamp: Date.now(),
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error creating snapshot',
      }, 500);
    }
  });

  // Estado del sistema
  app.get('/api/v2/system/status', async (c) => {
    try {
      const products = productManager.listProducts();
      const templates = templateEngine.listTemplates();
      const metrics = analyticsEngine.getRealTimeMetrics();

      return c.json({
        success: true,
        system: {
          products: {
            total: products.length,
            enabled: products.filter(p => p.enabled).length,
          },
          templates: {
            total: templates.length,
          },
          metrics,
          uptime: process.uptime(),
        },
      });
    } catch (error) {
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Error getting system status',
      }, 500);
    }
  });
}

// ================================
// INTEGRACIÓN CON INDEX.TSX
// ================================

// Agregar al final de index.tsx, antes de iniciar el servidor:
/*

import { 
  registerProductRoutes, 
  registerTemplateRoutes, 
  registerAnalyticsRoutes,
  registerSystemRoutes 
} from './api-routes-v2';

// Registrar rutas v2
registerProductRoutes(app);
registerTemplateRoutes(app);
registerAnalyticsRoutes(app);
registerSystemRoutes(app);

// Integrar analytics en el endpoint existente de provisioning
// Agregar en el POST /api/v1/devices/provision después de éxito:

analyticsEngine.trackEvent({
  type: 'provisioning_complete',
  data: {
    deviceName,
    customerName: finalCustomerName,
    processingTime,
  },
});

// Y después de fallo:

analyticsEngine.trackEvent({
  type: 'provisioning_failed',
  data: {
    error: error.message,
    processingTime,
  },
});

*/
