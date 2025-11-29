import React, { useState, useEffect } from 'react';
import { AlertCircle, Activity, Package, FileText, TrendingUp, Plus, Edit, Trash2, RefreshCw } from 'lucide-react';

// ================================
// API CLIENT
// ================================

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:15182';

const api = {
  products: {
    list: async () => {
      const res = await fetch(`${API_BASE}/api/v2/products`);
      return res.json();
    },
    create: async (data: any) => {
      const res = await fetch(`${API_BASE}/api/v2/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_BASE}/api/v2/products/${id}`, {
        method: 'DELETE',
      });
      return res.json();
    },
  },
  templates: {
    list: async () => {
      const res = await fetch(`${API_BASE}/api/v2/templates`);
      return res.json();
    },
  },
  analytics: {
    realtime: async () => {
      const res = await fetch(`${API_BASE}/api/v2/analytics/real-time`);
      return res.json();
    },
    insights: async () => {
      const res = await fetch(`${API_BASE}/api/v2/analytics/insights`);
      return res.json();
    },
  },
  system: {
    status: async () => {
      const res = await fetch(`${API_BASE}/api/v2/system/status`);
      return res.json();
    },
    snapshot: async () => {
      const res = await fetch(`${API_BASE}/api/v2/system/snapshot`, {
        method: 'POST',
      });
      return res.json();
    },
  },
};

// ================================
// COMPONENTES
// ================================

function MetricCard({ title, value, icon: Icon, trend }: any) {
  return (
    <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
          {trend && (
            <p className="text-sm text-green-600 mt-1">
              ↑ {trend}
            </p>
          )}
        </div>
        <Icon className="w-12 h-12 text-blue-500 opacity-50" />
      </div>
    </div>
  );
}

function ProductCard({ product, onDelete }: any) {
  const typeColors = {
    sensor: 'bg-blue-100 text-blue-800',
    gateway: 'bg-green-100 text-green-800',
    actuator: 'bg-purple-100 text-purple-800',
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {product.name}
          </h3>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${typeColors[product.type]}`}>
            {product.type.toUpperCase()}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onDelete(product.id)}
            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      <div className="space-y-2 text-sm text-gray-600">
        <div className="flex justify-between">
          <span>Template:</span>
          <span className="font-medium">{product.provisioningTemplate}</span>
        </div>
        <div className="flex justify-between">
          <span>Campos:</span>
          <span className="font-medium">{Object.keys(product.specifications).length}</span>
        </div>
        <div className="flex justify-between">
          <span>Estado:</span>
          <span className={`font-medium ${product.enabled ? 'text-green-600' : 'text-gray-400'}`}>
            {product.enabled ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </div>
      
      <div className="mt-4 pt-4 border-t text-xs text-gray-500">
        Creado: {new Date(product.created).toLocaleDateString()}
      </div>
    </div>
  );
}

function CreateProductModal({ isOpen, onClose, onSuccess }: any) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'sensor',
    provisioningTemplate: 'default',
  });

  const [specs, setSpecs] = useState([
    { name: 'serialNumber', type: 'string', label: 'Número de Serie', required: true },
  ]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const specifications: any = {};
    specs.forEach(spec => {
      specifications[spec.name] = {
        type: spec.type,
        label: spec.label,
        required: spec.required,
      };
    });

    try {
      const result = await api.products.create({
        ...formData,
        specifications,
      });

      if (result.success) {
        onSuccess();
        onClose();
      }
    } catch (error) {
      console.error('Error creating product:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Crear Nuevo Producto
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nombre del Producto
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tipo
            </label>
            <select
              value={formData.type}
              onChange={e => setFormData({...formData, type: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="sensor">Sensor</option>
              <option value="gateway">Gateway</option>
              <option value="actuator">Actuador</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Template de Provisioning
            </label>
            <input
              type="text"
              value={formData.provisioningTemplate}
              onChange={e => setFormData({...formData, provisioningTemplate: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Especificaciones
            </label>
            {specs.map((spec, idx) => (
              <div key={idx} className="bg-gray-50 p-4 rounded-lg mb-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Nombre del campo"
                    value={spec.name}
                    onChange={e => {
                      const newSpecs = [...specs];
                      newSpecs[idx].name = e.target.value;
                      setSpecs(newSpecs);
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-lg"
                  />
                  <input
                    type="text"
                    placeholder="Etiqueta"
                    value={spec.label}
                    onChange={e => {
                      const newSpecs = [...specs];
                      newSpecs[idx].label = e.target.value;
                      setSpecs(newSpecs);
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSpecs([...specs, { name: '', type: 'string', label: '', required: false }])}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              + Agregar especificación
            </button>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Crear Producto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ================================
// APP PRINCIPAL
// ================================

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [insights, setInsights] = useState([]);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [productsRes, templatesRes, metricsRes, insightsRes, statusRes] = await Promise.all([
        api.products.list(),
        api.templates.list(),
        api.analytics.realtime(),
        api.analytics.insights(),
        api.system.status(),
      ]);

      if (productsRes.success) setProducts(productsRes.products);
      if (templatesRes.success) setTemplates(templatesRes.templates);
      if (metricsRes.success) setMetrics(metricsRes.metrics);
      if (insightsRes.success) setInsights(insightsRes.insights);
      if (statusRes.success) setSystemStatus(statusRes.system);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('¿Eliminar este producto?')) return;
    
    try {
      const result = await api.products.delete(id);
      if (result.success) {
        loadData();
      }
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  };

  const handleSnapshot = async () => {
    try {
      const result = await api.system.snapshot();
      if (result.success) {
        alert('Snapshot creado exitosamente');
      }
    } catch (error) {
      console.error('Error creating snapshot:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                iotana
              </div>
              <div className="text-sm text-gray-600">TempLogger Pro v2.0</div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={loadData}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
              <button
                onClick={handleSnapshot}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Crear Snapshot
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-8">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: Activity },
              { id: 'products', label: 'Productos', icon: Package },
              { id: 'templates', label: 'Templates', icon: FileText },
              { id: 'analytics', label: 'Analytics', icon: TrendingUp },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-4 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Insights */}
            {insights.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-yellow-900 mb-2">Insights del Sistema</h3>
                    <ul className="space-y-1">
                      {insights.map((insight, idx) => (
                        <li key={idx} className="text-sm text-yellow-800">{insight}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <MetricCard
                title="Provisionings (1h)"
                value={metrics?.provisioning?.total || 0}
                icon={Activity}
                trend={`${metrics?.provisioning?.successful || 0} exitosos`}
              />
              <MetricCard
                title="Productos"
                value={systemStatus?.products?.total || 0}
                icon={Package}
                trend={`${systemStatus?.products?.enabled || 0} activos`}
              />
              <MetricCard
                title="Templates"
                value={systemStatus?.templates?.total || 0}
                icon={FileText}
              />
              <MetricCard
                title="Tiempo Promedio"
                value={`${metrics?.provisioning?.avgTime || 0}ms`}
                icon={TrendingUp}
              />
            </div>

            {/* System Info */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Estado del Sistema</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Uptime:</span>
                  <span className="ml-2 font-medium">{Math.floor((systemStatus?.uptime || 0) / 60)} min</span>
                </div>
                <div>
                  <span className="text-gray-600">Tasa de Éxito:</span>
                  <span className="ml-2 font-medium text-green-600">
                    {metrics?.provisioning?.total > 0
                      ? Math.round((metrics.provisioning.successful / metrics.provisioning.total) * 100)
                      : 0}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'products' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">Productos</h2>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                <Plus className="w-5 h-5" />
                Nuevo Producto
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((product: any) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onDelete={handleDeleteProduct}
                />
              ))}
            </div>

            {products.length === 0 && (
              <div className="text-center py-12 text-gray-600">
                No hay productos creados. Crea tu primer producto para comenzar.
              </div>
            )}
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Templates de Provisioning</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {templates.map((template: any) => (
                <div key={template.id} className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {template.name}
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">{template.description}</p>
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">{Object.keys(template.fields).length}</span> campos configurados
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
            
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Provisioning (Última hora)</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total de requests</span>
                  <span className="text-2xl font-bold text-gray-900">
                    {metrics?.provisioning?.total || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Exitosos</span>
                  <span className="text-xl font-semibold text-green-600">
                    {metrics?.provisioning?.successful || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Fallidos</span>
                  <span className="text-xl font-semibold text-red-600">
                    {metrics?.provisioning?.failed || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Tiempo promedio</span>
                  <span className="text-xl font-semibold text-blue-600">
                    {metrics?.provisioning?.avgTime || 0}ms
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateProductModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={loadData}
      />
    </div>
  );
}
