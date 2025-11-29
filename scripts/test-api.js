const BASE_URL = 'http://localhost:15182';
const API_KEY = process.env.PROVISIONING_API_KEY || 'your-api-key';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

async function testEndpoint(name, method, path, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`${colors.green}✓${colors.reset} ${name}`);
      return data;
    } else {
      console.log(`${colors.red}✗${colors.reset} ${name}: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset} ${name}: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log(`${colors.blue}TempLogger Pro v2.0 - API Tests${colors.reset}\n`);

  // Health check
  await testEndpoint('Health Check', 'GET', '/api/health');
  
  // Sistema
  await testEndpoint('System Status', 'GET', '/api/v2/system/status');
  
  // Productos
  console.log(`\n${colors.yellow}Productos${colors.reset}`);
  await testEndpoint('List Products', 'GET', '/api/v2/products');
  
  const newProduct = await testEndpoint('Create Product', 'POST', '/api/v2/products', {
    name: 'Test Sensor',
    type: 'sensor',
    specifications: {
      serialNumber: {
        type: 'string',
        label: 'Serial',
        required: true
      }
    },
    provisioningTemplate: 'default'
  });

  if (newProduct?.product?.id) {
    await testEndpoint('Get Product', 'GET', `/api/v2/products/${newProduct.product.id}`);
    await testEndpoint('Delete Product', 'DELETE', `/api/v2/products/${newProduct.product.id}`);
  }

  // Templates
  console.log(`\n${colors.yellow}Templates${colors.reset}`);
  await testEndpoint('List Templates', 'GET', '/api/v2/templates');
  
  // Analytics
  console.log(`\n${colors.yellow}Analytics${colors.reset}`);
  await testEndpoint('Real-time Metrics', 'GET', '/api/v2/analytics/real-time');
  await testEndpoint('Insights', 'GET', '/api/v2/analytics/insights');
  await testEndpoint('Event History', 'GET', '/api/v2/analytics/events/history');
  
  // Provisioning
  console.log(`\n${colors.yellow}Provisioning${colors.reset}`);
  await testEndpoint('Provision Device', 'POST', '/api/v1/devices/provision', {
    serialNumber: 'TEST001',
    sensorName: 'Sensor Test',
    customerName: 'Test Customer',
    userEmail: 'test@example.com',
    createUser: false
  });

  console.log(`\n${colors.green}Tests completed!${colors.reset}`);
}

runTests();
