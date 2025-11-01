// index.tsx - TempLogger Pro High-Performance Provisioning Server
// process + Hono + ThingsBoard CE - Optimized for 3200+ req/hour


import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { timeout } from "hono/timeout";
import { serve } from '@hono/node-server'
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();
const app = new Hono();

// ================================
// CONFIGURACION Y CONSTANTES
// ================================

const TB_CONFIG = {
    host: process.env.TB_HOST || "iotana.mooo.com",
    port: process.env.TB_PORT || "9090",
    protocol: process.env.TB_PROTOCOL || "http",
    username: process.env.TB_USERNAME || "tenant@thingsboard.org",
    password: process.env.TB_PASSWORD || "tenant",
    dashboardTemplateId: process.env.TB_DASHBOARD_TEMPLATE_ID,
    deviceProfileId: process.env.TB_DEVICE_PROFILE_ID,
    maxRetries: parseInt(process.env.TB_MAX_RETRIES || "3"),
    retryDelay: parseInt(process.env.TB_RETRY_DELAY || "1000"),
    requestTimeout: parseInt(process.env.TB_REQUEST_TIMEOUT || "30000"),
};

function generateSimplePassword(length: number = 10): string {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const allChars = lowercase + uppercase + numbers;

    let password = '';

    // Asegurar al menos: 1 mayúscula, 1 minúscula, 2 números
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];

    // Completar el resto
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Mezclar caracteres
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

const PERFORMANCE_CONFIG = {
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || "50"),
    cacheTimeout: parseInt(process.env.CACHE_TIMEOUT || "300000"), // 5min
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || "3600000"), // 1h
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100"), // por IP
    globalRateLimit: parseInt(process.env.GLOBAL_RATE_LIMIT || "3500"), // global/hora
    poolSize: parseInt(process.env.CONNECTION_POOL_SIZE || "20"),
};

// ================================
// SISTEMA DE CACHE IN-MEMORY
// ================================

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

class HighPerformanceCache {
    private cache = new Map<string, CacheEntry<any>>();
    private stats = { hits: 0, misses: 0, sets: 0 };

    set<T>(
        key: string,
        data: T,
        ttl: number = PERFORMANCE_CONFIG.cacheTimeout
    ): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl,
        });
        this.stats.sets++;
        this.cleanup(); // Limpieza periodica
    }

    get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) {
            this.stats.misses++;
            return null;
        }

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            this.stats.misses++;
            return null;
        }

        this.stats.hits++;
        return entry.data;
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    private cleanup(): void {
        if (this.cache.size > 10000) {
            // Limite de memoria
            const now = Date.now();
            for (const [key, entry] of this.cache.entries()) {
                if (now - entry.timestamp > entry.ttl) {
                    this.cache.delete(key);
                }
            }
        }
    }

    getStats() {
        const hitRate =
            this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
        return { ...this.stats, hitRate: Math.round(hitRate * 100) };
    }

    clear(): void {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, sets: 0 };
    }
}

const cache = new HighPerformanceCache();

// ================================
// SISTEMA DE RATE LIMITING PERSONALIZADO
// ================================

class IPRateLimiter {
    private requests = new Map<string, number[]>();
    private readonly windowMs = PERFORMANCE_CONFIG.rateLimitWindow;
    private readonly maxRequests = PERFORMANCE_CONFIG.rateLimitMax;

    canProceed(ip: string): boolean {
        const now = Date.now();
        const userRequests = this.requests.get(ip) || [];

        // Limpiar requests antiguos
        const validRequests = userRequests.filter(
            (time) => now - time < this.windowMs
        );

        if (validRequests.length >= this.maxRequests) {
            this.requests.set(ip, validRequests);
            return false;
        }

        validRequests.push(now);
        this.requests.set(ip, validRequests);

        // Cleanup periodico del Map
        if (this.requests.size > 10000) {
            this.cleanup(now);
        }

        return true;
    }

    private cleanup(now: number): void {
        for (const [ip, requests] of this.requests.entries()) {
            const validRequests = requests.filter(
                (time) => now - time < this.windowMs
            );
            if (validRequests.length === 0) {
                this.requests.delete(ip);
            } else {
                this.requests.set(ip, validRequests);
            }
        }
    }

    getStatus(ip: string) {
        const now = Date.now();
        const userRequests = this.requests.get(ip) || [];
        const validRequests = userRequests.filter(
            (time) => now - time < this.windowMs
        );

        return {
            current: validRequests.length,
            max: this.maxRequests,
            remaining: Math.max(0, this.maxRequests - validRequests.length),
            resetTime: new Date(now + this.windowMs).toISOString(),
        };
    }
}

class GlobalRateLimiter {
    private requests: number[] = [];
    private readonly windowMs = PERFORMANCE_CONFIG.rateLimitWindow;
    private readonly maxRequests = PERFORMANCE_CONFIG.globalRateLimit;

    canProceed(): boolean {
        const now = Date.now();
        // Limpiar requests antiguos
        this.requests = this.requests.filter((time) => now - time < this.windowMs);

        if (this.requests.length >= this.maxRequests) {
            return false;
        }

        this.requests.push(now);
        return true;
    }

    getStatus() {
        const now = Date.now();
        this.requests = this.requests.filter((time) => now - time < this.windowMs);
        return {
            current: this.requests.length,
            max: this.maxRequests,
            remaining: Math.max(0, this.maxRequests - this.requests.length),
            resetTime: new Date(now + this.windowMs).toISOString(),
        };
    }
}

const ipRateLimit = new IPRateLimiter();
const globalRateLimit = new GlobalRateLimiter();

// ================================
// SISTEMA DE CONTROL DE CONCURRENCIA
// ================================

class ConcurrencyController {
    private activeRequests = 0;
    private queue: (() => void)[] = [];
    private readonly maxConcurrent = PERFORMANCE_CONFIG.maxConcurrentRequests;

    async acquire<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            const execute = async () => {
                this.activeRequests++;
                try {
                    const result = await operation();
                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    this.activeRequests--;
                    this.processQueue();
                }
            };

            if (this.activeRequests < this.maxConcurrent) {
                execute();
            } else {
                this.queue.push(execute);
            }
        });
    }

    private processQueue(): void {
        if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
            const next = this.queue.shift();
            if (next) next();
        }
    }

    getStats() {
        return {
            active: this.activeRequests,
            queued: this.queue.length,
            maxConcurrent: this.maxConcurrent,
        };
    }
}

const concurrencyController = new ConcurrencyController();

// ================================
// CLIENTE HTTP OPTIMIZADO
// ================================

class OptimizedHTTPClient {
    private tokenCache: { token: string; expiry: number } | null = null;

    private async makeRequest(
        url: string,
        options: RequestInit,
        retries = TB_CONFIG.maxRetries
    ): Promise<Response> {
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            TB_CONFIG.requestTimeout
        );

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok && retries > 0 && response.status >= 500) {
                console.warn(`Retry attempt for ${url}, status: ${response.status}`);
                await new Promise((resolve) =>
                    setTimeout(resolve, TB_CONFIG.retryDelay)
                );
                return this.makeRequest(url, options, retries - 1);
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            if (
                retries > 0 &&
                error instanceof Error &&
                error.name !== "AbortError"
            ) {
                console.warn(`Retry attempt for ${url}, error: ${error.message}`);
                await new Promise((resolve) =>
                    setTimeout(resolve, TB_CONFIG.retryDelay)
                );
                return this.makeRequest(url, options, retries - 1);
            }

            throw error;
        }
    }

    async authenticate(): Promise<string> {
        // Check cache first
        if (this.tokenCache && Date.now() < this.tokenCache.expiry) {
            return this.tokenCache.token;
        }

        const url = `${TB_CONFIG.protocol}://${TB_CONFIG.host}:${TB_CONFIG.port}/api/auth/login`;

        const response = await this.makeRequest(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: TB_CONFIG.username,
                password: TB_CONFIG.password,
            }),
        });

        if (!response.ok) {
            throw new Error(
                `Authentication failed: ${response.status} ${response.statusText}`
            );
        }

        const data = await response.json();
        this.tokenCache = {
            token: data.token,
            expiry: Date.now() + 11 * 60 * 60 * 1000, // 11 horas (margen de seguridad)
        };

        return this.tokenCache.token;
    }

    async request(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<Response> {
        return concurrencyController.acquire(async () => {
            const token = await this.authenticate();
            const url = `${TB_CONFIG.protocol}://${TB_CONFIG.host}:${TB_CONFIG.port}${endpoint}`;

            const response = await this.makeRequest(url, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    "X-Authorization": `Bearer ${token}`,
                    ...options.headers,
                },
            });

            return response;
        });
    }
}

const httpClient = new OptimizedHTTPClient();

// ================================
// MIDDLEWARES DE RENDIMIENTO
// ================================

// Rate limiting personalizado por IP
app.use("/api/*", async (c, next) => {
    const ip =
        process.env.CF_CONNECTING_IP ||
        c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
        c.req.header("x-real-ip") ||
        "unknown";

    if (!ipRateLimit.canProceed(ip)) {
        return c.json(
            {
                success: false,
                message: "Rate limit exceeded for your IP",
                rateLimitStatus: ipRateLimit.getStatus(ip),
            },
            429
        );
    }

    // Agregar headers de rate limiting
    const status = ipRateLimit.getStatus(ip);
    c.header("X-RateLimit-Limit", status.max.toString());
    c.header("X-RateLimit-Remaining", status.remaining.toString());
    c.header("X-RateLimit-Reset", status.resetTime);

    await next();
});

// Timeout global
app.use("/*", timeout(30000));

// CORS optimizado
app.use(
    "/*",
    cors({
        origin: "*",
        allowMethods: ["GET", "POST", "DELETE"],
        maxAge: 86400, // Cache preflight por 24h
    })
);

// Logger solo para errores en producción
if (process.env.NODE_ENV !== "production") {
    app.use("/*", logger());
}

// Rate limiting global
app.use("/api/*", async (c, next) => {
    if (!globalRateLimit.canProceed()) {
        return c.json(
            {
                success: false,
                message: "Global rate limit exceeded",
                rateLimitStatus: globalRateLimit.getStatus(),
            },
            429
        );
    }
    await next();
});

//seguridad
app.use("/api/v1/*", async (c, next) => {
    const expectedKey = process.env.PROVISIONING_API_KEY;
    const providedKey = c.req.header("x-api-key") || c.req.query("apiKey"); // opcionalmente también por query param

    if (!expectedKey) {
        console.warn(
            "⚠️ PROVISIONING_API_KEY no configurada — se permite acceso libre"
        );
        return await next(); // no bloquear si estás en modo desarrollo
    }
    if (providedKey !== expectedKey) {
        return c.json(
            {
                success: false,
                message: `Unauthorized: invalid or missing API key (${providedKey || "none"
                    })`,
            },
            401
        );
    }

    await next();
});

// ================================
// SERVICIOS DE NEGOCIO OPTIMIZADOS
// ================================

// CustomerService actualizado con numeración incremental
class CustomerService {
    async getOrCreateWithIncrement(customerName: string): Promise<any> {
        const baseCacheKey = `customer:${customerName}`;
        let customer = cache.get(baseCacheKey) as Record<string, any> | undefined; if (customer) { return customer; }

        try {
            // Buscar clientes existentes con el nombre base
            const searchResponse = await httpClient.request(
                `/api/customers?pageSize=100&page=0&textSearch=${encodeURIComponent(
                    customerName
                )}`
            );

            if (!searchResponse.ok) {
                throw new Error(
                    `Error searching customer: ${searchResponse.statusText}`
                );
            }

            const searchData = await searchResponse.json();

            // Buscar coincidencia exacta primero
            const exactMatch = searchData.data.find(
                (c: any) => c.title === customerName
            );

            if (exactMatch) {
                cache.set(baseCacheKey, exactMatch);
                return exactMatch;
            }

            // Si no hay coincidencia exacta, buscar el siguiente número disponible
            const finalCustomerName = await this.findAvailableCustomerName(
                customerName,
                searchData.data
            );

            // Crear nuevo cliente con el nombre final
            const createResponse = await httpClient.request("/api/customer", {
                method: "POST",
                body: JSON.stringify({
                    title: finalCustomerName,
                    name: finalCustomerName,
                    additionalInfo: {
                        description: `Cliente TempLogger Pro - Auto-created`,
                        createdBy: "Auto-Provisioning",
                        createdDate: new Date().toISOString(),
                        originalName: customerName, // Guardamos el nombre original
                    },
                }),
            });

            if (!createResponse.ok) {
                if (createResponse.status === 480) {
                    console.warn(
                        `Customer ${finalCustomerName} posiblemente ya existe. Intentando recuperar...`
                    );
                    // Buscar otra vez con el nombre final
                    const retryResponse = await httpClient.request(
                        `/api/customers?pageSize=100&page=0&textSearch=${encodeURIComponent(
                            finalCustomerName
                        )}`
                    );
                    const retryData = await retryResponse.json();
                    const existing = retryData.data.find(
                        (c: any) => c.title === finalCustomerName
                    );
                    if (existing) return existing;
                }
                throw new Error(
                    `Error creating customer: ${createResponse.statusText}`
                );
            }

            customer = await createResponse.json();

            // Cache tanto el nombre base como el final
            cache.set(baseCacheKey, customer);
            cache.set(`customer:${finalCustomerName}`, customer);

            console.log(`Customer created: ${finalCustomerName} (${(customer as any).id.id})`);
            return customer;
        } catch (error) {
            console.error(`Customer service error for ${customerName}:`, error);
            throw error;
        }
    }

    private async findAvailableCustomerName(
        baseName: string,
        existingCustomers: Array<Record<string, any>>
    ): Promise<string> {
        // Extraer todos los nombres que siguen el patrón: "BaseName", "BaseName 01", "BaseName 02", etc.
        const pattern = new RegExp(
            `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: (\\d{2}))?$`
        );
        const usedNumbers = new Set<number>();

        existingCustomers.forEach((customer) => {
            const match = customer.title.match(pattern);
            if (match) {
                if (match[1]) {
                    // Tiene número, agregarlo al set
                    usedNumbers.add(parseInt(match[1], 10));
                } else {
                    // Es el nombre base sin número, equivale a 00
                    usedNumbers.add(0);
                }
            }
        });

        // Si el nombre base (equivalente a 00) no está usado, devolverlo
        if (!usedNumbers.has(0)) {
            return baseName;
        }

        // Buscar el siguiente número disponible empezando desde 01
        for (let i = 1; i <= 99; i++) {
            if (!usedNumbers.has(i)) {
                return `${baseName} ${i.toString().padStart(2, "0")}`;
            }
        }

        // Si llegamos aquí, hay más de 99 clientes con el mismo nombre base
        // Usar timestamp como fallback
        const timestamp = Date.now().toString().slice(-4);
        return `${baseName} ${timestamp}`;
    }

    // Método original renombrado para compatibilidad
    async getOrCreate(customerName: string): Promise<any> {
        return this.getOrCreateWithIncrement(customerName);
    }
}

interface CreateUserParams {
    email: string;
    customerId: string;
    customerName: string;
    deviceName?: string;
    firstName?: string;
    lastName?: string;
    sendEmail?: boolean;
}

interface UserResult {
    user: any;
    password: string;
    emailSent: boolean;
    isExisting: boolean;
}

interface EmailCredentials {
    email: string;
    password: string;
    customerName: string;
    deviceName: string;
    thingsboardUrl: string;
}

class EmailService {
    private transporter: Transporter | null = null;
    private isConfigured: boolean = false;
    private config = {
        user: process.env.EMAIL_USER || '',
        password: process.env.EMAIL_PASSWORD || '',
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
        thingsboardUrl: process.env.THINGSBOARD_PUBLIC_URL ||
            `${TB_CONFIG.protocol}://${TB_CONFIG.host}:${TB_CONFIG.port}`,
    };

    constructor() {
        this.initialize();
    }

    private initialize(): void {
        if (!this.config.user || !this.config.password) {
            console.warn('⚠️ Email service not configured. Set EMAIL_USER and EMAIL_PASSWORD in .env');
            return;
        }

        try {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: this.config.user,
                    pass: this.config.password,
                },
            });
            this.isConfigured = true;
            console.log('✅ Email service initialized');
        } catch (error) {
            console.error('❌ Error initializing email service:', error);
        }
    }

    async sendCredentials(data: EmailCredentials): Promise<boolean> {
        if (!this.isConfigured || !this.transporter) {
            console.warn('⚠️ Email service not configured, skipping email');
            return false;
        }

        try {
            const mailOptions = {
                from: `"IOTANA - Sistema de Monitoreo" <${this.config.from}>`,
                to: data.email,
                subject: `🔐 Credenciales de Acceso - ${data.customerName}`,
                html: this.generateEmailTemplate(data),
                text: this.generatePlainText(data),
            };

            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ Email sent to ${data.email} (${info.messageId})`);
            return true;
        } catch (error) {
            console.error(`❌ Error sending email to ${data.email}:`, error);
            return false;
        }
    }

    private generateEmailTemplate(data: EmailCredentials): string {
        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; background-color: #f4f7fa;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
                    
                    <!-- Header IOTANA -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
                            <div style="font-size: 42px; font-weight: bold; color: #ffffff; margin-bottom: 10px;">iotana</div>
                            <div style="font-size: 18px; color: #ffffff;">Sistema de Monitoreo Inteligente</div>
                        </td>
                    </tr>
                    
                    <!-- Bienvenida -->
                    <tr>
                        <td style="padding: 40px 30px 20px;">
                            <h2 style="margin: 0 0 20px; color: #2d3748; font-size: 24px;">¡Bienvenido a IOTANA!</h2>
                            <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
                                Se ha creado una cuenta para acceder al sistema de monitoreo de <strong>${data.customerName}</strong>.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Tabla de Credenciales -->
                    <tr>
                        <td style="padding: 0 30px 30px;">
                            <table role="presentation" style="width: 100%; background-color: #f7fafc; border-radius: 8px; overflow: hidden;">
                                <tr>
                                    <td colspan="2" style="padding: 20px; background-color: #4299e1; color: white; font-weight: 600;">
                                        🔐 Sus Credenciales de Acceso
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px; border-bottom: 1px solid #e2e8f0; color: #2d3748; font-weight: 600; width: 40%;">Usuario:</td>
                                    <td style="padding: 15px 20px; border-bottom: 1px solid #e2e8f0; color: #4a5568; font-family: monospace;">${data.email}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px; border-bottom: 1px solid #e2e8f0; color: #2d3748; font-weight: 600;">Contraseña:</td>
                                    <td style="padding: 15px 20px; border-bottom: 1px solid #e2e8f0; color: #4a5568; font-family: monospace; font-size: 16px; font-weight: bold;">${data.password}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 20px; color: #2d3748; font-weight: 600;">Dispositivo:</td>
                                    <td style="padding: 15px 20px; color: #4a5568;">${data.deviceName}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Botón -->
                    <tr>
                        <td style="padding: 0 30px 30px; text-align: center;">
                            <a href="${data.thingsboardUrl}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #4299e1, #3182ce); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">
                                🚀 Acceder al Sistema
                            </a>
                        </td>
                    </tr>
                    
                    <!-- Instrucciones -->
                    <tr>
                        <td style="padding: 0 30px 30px;">
                            <div style="background-color: #fffbf0; border-left: 4px solid #f6e05e; padding: 20px; border-radius: 6px;">
                                <p style="margin: 0 0 10px; color: #744210; font-weight: 600;">⚠️ Instrucciones de Seguridad</p>
                                <ul style="margin: 0; padding-left: 20px; color: #744210; font-size: 14px; line-height: 1.6;">
                                    <li>Guarde estas credenciales en un lugar seguro</li>
                                    <li>Se recomienda cambiar la contraseña al primer ingreso</li>
                                    <li>No comparta sus credenciales</li>
                                </ul>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px; background-color: #f7fafc; text-align: center; border-radius: 0 0 12px 12px;">
                            <p style="margin: 0 0 10px; color: #718096; font-size: 14px;">Mensaje automático de IOTANA</p>
                            <p style="margin: 0; color: #cbd5e0; font-size: 12px;">© ${new Date().getFullYear()} IOTANA - Todos los derechos reservados</p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;
    }

    private generatePlainText(data: EmailCredentials): string {
        return `
IOTANA - Sistema de Monitoreo Inteligente

¡Bienvenido!

Se ha creado una cuenta para acceder al sistema de ${data.customerName}.

CREDENCIALES DE ACCESO
-----------------------
Usuario:     ${data.email}
Contraseña:  ${data.password}
Dispositivo: ${data.deviceName}

URL: ${data.thingsboardUrl}

INSTRUCCIONES
-------------
• Guarde estas credenciales en un lugar seguro
• Se recomienda cambiar la contraseña al primer ingreso
• No comparta sus credenciales

© ${new Date().getFullYear()} IOTANA
        `.trim();
    }

    isReady(): boolean {
        return this.isConfigured;
    }
}

class UserService {
    private httpClient: any;
    private emailService: EmailService;

    constructor(httpClient: any, emailService: EmailService) {
        this.httpClient = httpClient;
        this.emailService = emailService;
    }

    async createOrGetCustomerUser(params: CreateUserParams): Promise<UserResult> {
        const {
            email,
            customerId,
            customerName,
            deviceName = 'Dispositivo',
            firstName,
            lastName,
            sendEmail = true,
        } = params;

        try {
            // Verificar si usuario existe
            const existingUser = await this.findUserByEmail(email);

            if (existingUser) {
                console.log(`👤 Usuario existente: ${email}`);

                if (existingUser.customerId?.id === customerId) {
                    return {
                        user: existingUser,
                        password: '********',
                        emailSent: false,
                        isExisting: true,
                    };
                } else {
                    throw new Error(`El email ${email} ya está registrado en otro cliente`);
                }
            }

            // Generar contraseña
            const password = generateSimplePassword(10);

            // Extraer nombre del email si no se proporciona
            const [emailUsername] = email.split('@');
            const defaultFirstName = firstName || emailUsername.split('.')[0] || 'Usuario';
            const defaultLastName = lastName || emailUsername.split('.')[1] || 'IOTANA';

            // Crear usuario
            const userData = {
                email,
                authority: 'CUSTOMER_USER',
                customerId: {
                    entityType: 'CUSTOMER',
                    id: customerId
                },
                firstName: defaultFirstName.charAt(0).toUpperCase() + defaultFirstName.slice(1),
                lastName: defaultLastName.charAt(0).toUpperCase() + defaultLastName.slice(1),
                additionalInfo: {
                    description: `Usuario de ${customerName}`,
                    createdBy: 'Auto-Provisioning',
                    createdDate: new Date().toISOString(),
                    deviceAssociated: deviceName,
                },
            };

            const createResponse = await this.httpClient.request('/api/user?sendActivationMail=false', {
                method: 'POST',
                body: JSON.stringify(userData),
            });

            if (!createResponse.ok) {
                const errorText = await createResponse.text();
                throw new Error(`Error creando usuario: ${createResponse.status} - ${errorText}`);
            }

            const user = await createResponse.json();
            console.log(`✅ Usuario creado: ${email} (${user.id.id})`);

            // Activar usuario con contraseña
            await this.activateUser(user.id.id, password);

            // Enviar email
            let emailSent = false;
            if (sendEmail && this.emailService.isReady()) {
                emailSent = await this.emailService.sendCredentials({
                    email,
                    password,
                    customerName,
                    deviceName,
                    thingsboardUrl: process.env.THINGSBOARD_PUBLIC_URL ||
                        `${TB_CONFIG.protocol}://${TB_CONFIG.host}:${TB_CONFIG.port}`,
                });
            }

            return {
                user,
                password,
                emailSent,
                isExisting: false,
            };

        } catch (error) {
            console.error(`❌ Error en UserService:`, error);
            throw error;
        }
    }

    private async findUserByEmail(email: string): Promise<any | null> {
        try {
            const searchResponse = await this.httpClient.request(
                `/api/users?pageSize=10&page=0&textSearch=${encodeURIComponent(email)}`
            );

            if (!searchResponse.ok) return null;

            const searchData = await searchResponse.json();
            return searchData.data.find((u: any) => u.email === email) || null;
        } catch (error) {
            return null;
        }
    }

    private async activateUser(userId: string, password: string): Promise<void> {
        try {
            // Generar activation token
            const activationResponse = await this.httpClient.request(
                `/api/user/${userId}/activationLink`,
                { method: 'GET' }
            );

            if (!activationResponse.ok) {
                throw new Error('Error generando activation link');
            }

            const activationData = await activationResponse.json();
            const activationToken = activationData.activationLink.split('activateToken=')[1];

            if (!activationToken) {
                throw new Error('No se pudo extraer activation token');
            }

            // Activar con contraseña - TOKEN EN URL, PASSWORD EN BODY
            const activateResponse = await this.httpClient.request(
                `/api/noauth/activate?activateToken=${activationToken}&sendActivationMail=false`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        password: password,  // Solo password en el body
                    }),
                }
            );

            if (!activateResponse.ok) {
                throw new Error('Error activando usuario');
            }

            console.log(`✅ Usuario activado con contraseña`);
        } catch (error) {
            console.error('❌ Error activando usuario:', error);
            throw error;
        }
    }
}

class DeviceService {
    async createOrGet(
        deviceName: string,
        serialNumber: string,
        customer: any,
        sensorName?: string
    ): Promise<any> {
        const cacheKey = `device:${serialNumber}`;
        let cachedDevice = cache.get(cacheKey);
        const cached = cache.get(cacheKey);
        if (cached) {
            // ✅ VERIFICAR que el dispositivo aún existe en ThingsBoard
            const stillExists = await this.verifyDeviceExists(
                (cached as any)?.device?.id?.id ?? ""
            );

            if (stillExists) {
                console.log(`✅ Cache válido: ${deviceName}`);
                return cached;
            } else {
                console.log(`🔄 Dispositivo en cache fue borrado, limpiando...`);
                cache.delete(cacheKey);
            }
        }

        if (cachedDevice) {
            return cachedDevice;
        }

        try {
            // ✅ PRIMERO: Buscar por deviceIdentity (customerName + sensorName)
            // Asumimos que customerName y sensorName están disponibles en el contexto
            // o los pasamos como parámetros adicionales
            const deviceIdentity = `${customer.title} - ${sensorName}`;

            const existingDevice = await this.findDeviceByIdentity(
                deviceIdentity,
                customer.id.id
            );

            if (existingDevice) {
                // ✅ ENCONTRADO: Actualizar nombre y serial
                console.log(
                    `🔄 Recambio detectado: ${existingDevice.name} → ${deviceName}`
                );

                const updatedDevice = await this.updateDeviceForReplacement(
                    existingDevice,
                    deviceName,
                    serialNumber
                );

                const credentials = await this.getDeviceCredentials(
                    updatedDevice.id.id
                );

                const result = {
                    device: updatedDevice,
                    credentials,
                    isExisting: true,
                    isReplacement: true,
                    previousSensor: existingDevice.label,
                };

                cache.set(cacheKey, result, 300000); // 5 minutos
                return result;
            }

            // ✅ NO ENCONTRADO: Crear nuevo (tu código original)
            const searchResponse = await httpClient.request(
                `/api/tenant/devices?pageSize=100&page=0&textSearch=${encodeURIComponent(
                    serialNumber
                )}`
            );

            if (!searchResponse.ok) {
                throw new Error(`Error searching device: ${searchResponse.statusText}`);
            }

            const searchData = await searchResponse.json();
            const existingBySerial = searchData.data.find(
                (d: any) => d.name === deviceName || d.label === serialNumber
            );

            if (existingBySerial) {
                // Obtener credenciales del existente
                const credentialsResponse = await httpClient.request(
                    `/api/device/${existingBySerial.id.id}/credentials`
                );

                const credentials = credentialsResponse.ok
                    ? await credentialsResponse.json()
                    : null;

                const result = {
                    device: existingBySerial,
                    credentials,
                    isExisting: true,
                };

                cache.set(cacheKey, result, 600000);
                return result;
            }

            // Crear nuevo dispositivo CON LA DESCRIPCIÓN CORRECTA
            const deviceData = {
                name: deviceName,
                label: serialNumber,
                deviceProfileId: TB_CONFIG.deviceProfileId
                    ? { id: TB_CONFIG.deviceProfileId }
                    : null,
                additionalInfo: {
                    description: deviceIdentity, // ✅ GUARDAR EL DEVICE IDENTITY
                    serialNumber,
                    productName: "TempLogger Pro",
                    createdBy: "Auto-Provisioning",
                    createdDate: new Date().toISOString(),
                },
            };

            const deviceResponse = await httpClient.request("/api/device", {
                method: "POST",
                body: JSON.stringify(deviceData),
            });

            if (!deviceResponse.ok) {
                throw new Error(`Error creating device: ${deviceResponse.statusText}`);
            }

            const device = await deviceResponse.json();

            // Asignar a customer
            try {
                await httpClient.request(
                    `/api/customer/${customer.id.id}/device/${device.id.id}`,
                    {
                        method: "POST",
                        body: "{}",
                    }
                );
            } catch (assignError) {
                console.warn("⚠️ Could not assign device to customer:", assignError);
            }

            const credentialsResponse = await httpClient.request(
                `/api/device/${device.id.id}/credentials`
            );

            const credentials = credentialsResponse.ok
                ? await credentialsResponse.json()
                : null;

            const result = {
                device,
                credentials,
                isExisting: false,
            };

            cache.set(cacheKey, result, 1800000);
            console.log(`✅ Device created: ${deviceName} (${device.id.id})`);

            return result;
        } catch (error) {
            console.error(`❌ Device service error for ${deviceName}:`, error);
            throw error;
        }
    }

    // MÉTODO SIMPLE para buscar por deviceIdentity
    private async findDeviceByIdentity(
        deviceIdentity: string,
        customerId: string
    ): Promise<any | null> {
        try {
            const searchResponse = await httpClient.request(
                `/api/customer/${customerId}/devices?pageSize=1000&page=0`
            );

            if (!searchResponse.ok) return null;

            const searchData = await searchResponse.json();

            return (
                searchData.data.find(
                    (d: any) => d.additionalInfo?.description === deviceIdentity
                ) || null
            );
        } catch (error) {
            console.warn("Error buscando por identity:", error);
            return null;
        }
    }

    // MÉTODO SIMPLE para actualizar
    private async updateDeviceForReplacement(
        existingDevice: any,
        newDeviceName: string,
        newSerialNumber: string
    ): Promise<any> {
        const updateResponse = await httpClient.request(`/api/device`, {
            method: "POST",
            body: JSON.stringify({
                ...existingDevice,
                name: newDeviceName,
                label: newSerialNumber,
                additionalInfo: {
                    ...existingDevice.additionalInfo,
                    serialNumber: newSerialNumber,
                },
            }),
        });

        if (!updateResponse.ok) {
            throw new Error(`Error updating device: ${updateResponse.statusText}`);
        }

        return await updateResponse.json();
    }

    // MÉTODO SIMPLE para obtener token y credenciales
    private async getDeviceCredentials(deviceId: string): Promise<any> {
        try {
            const credentialsResponse = await httpClient.request(
                `/api/device/${deviceId}/credentials`
            );

            if (!credentialsResponse.ok) {
                throw new Error(
                    `Error getting device credentials: ${credentialsResponse.statusText}`
                );
            }

            return await credentialsResponse.json();
        } catch (error) {
            console.error(`Error getting credentials for device ${deviceId}:`, error);
            throw error;
        }
    }

    private async verifyDeviceExists(deviceId: string): Promise<boolean> {
        try {
            const response = await httpClient.request(`/api/device/${deviceId}`);
            return response.ok; // Si responde 200, existe
        } catch (error) {
            return false; // Si hay error, no existe
        }
    }
}

class DashboardService {
    async cloneAndAssign(
        deviceId: string,
        deviceName: string,
        customerId: string
    ): Promise<any> {
        if (!TB_CONFIG.dashboardTemplateId) {
            console.warn(
                "⚠️ No dashboard template ID configured, skipping dashboard creation"
            );
            return null;
        }
        const cacheKey = `dashboard_template:${TB_CONFIG.dashboardTemplateId}`;
        let template = cache.get(cacheKey);
        try {
            console.log("🔍 Fetching template:", TB_CONFIG.dashboardTemplateId);
            // Obtener template (con cache)
            if (!template) {
                const templateResp = await httpClient.request(
                    `/api/dashboard/${TB_CONFIG.dashboardTemplateId}`
                );
                if (!templateResp.ok) {
                    throw new Error(`Error getting template: ${templateResp.statusText}`);
                }
                template = await templateResp.json();
                cache.set(cacheKey, template, 3600000); // Cache template 1h
            }
            // Clonar y modificar configuración
            const clonedConfig = this.replaceDeviceInConfig(
                (template as { configuration: any }).configuration,
                deviceId
            );

            console.log("🔍 Device ID replacement completed");
            const dashboardName = `Dashboard - ${deviceName}`;
            // Crear dashboard
            const dashResp = await httpClient.request("/api/dashboard", {
                method: "POST",
                body: JSON.stringify({
                    title: dashboardName,
                    configuration: clonedConfig,
                }),
            });
            if (!dashResp.ok) {
                throw new Error(`Error creating dashboard: ${dashResp.statusText}`);
            }
            const dashboard = await dashResp.json();
            // Asignar a customer
            try {
                await httpClient.request(
                    `/api/customer/${customerId}/dashboard/${dashboard.id.id}`,
                    {
                        method: "POST",
                    }
                );
            } catch (assignError) {
                console.warn("⚠️ Could not assign dashboard to customer:", assignError);
            }
            console.log(`✅ Dashboard created and assigned: ${dashboardName}`);
            return dashboard;
        } catch (error) {
            console.error("❌ Dashboard service error details:", error);
            if (error instanceof Error) {
                console.error("❌ Error stack:", error.stack);
            } else {
                console.error("❌ Error:", error);
            }
            return null;
        }
    }

    private replaceDeviceInConfig(config: any, deviceId: string): any {
        const cloned = JSON.parse(JSON.stringify(config));

        // Reemplazar device ID en entityAliases
        if (cloned.entityAliases && typeof cloned.entityAliases === "object") {
            for (const alias of Object.values(cloned.entityAliases) as any[]) {
                if (
                    alias.filter?.type === "singleEntity" &&
                    alias.filter?.singleEntity?.entityType === "DEVICE"
                ) {
                    alias.filter.singleEntity.id = deviceId;
                    console.log(`Device ID replaced in entity alias: ${alias.alias}`);
                }
            }
        }

        return cloned;
    }
}

// Instancias de servicios
const customerService = new CustomerService();
const deviceService = new DeviceService();
const dashboardService = new DashboardService();
const emailService = new EmailService();
const userService = new UserService(httpClient, emailService);

// ================================
// UTILIDADES
// ================================

function determineCustomerName(serialNumber: string): string {
    const lastDigit = parseInt(serialNumber.slice(-1), 16) % 3;
    switch (lastDigit) {
        case 0:
            return "Panadería López";
        case 1:
            return "Supermercado Central";
        default:
            return "Cliente Demo";
    }
}

function validateProvisioningRequest(body: any): string | null {
    if (!body.serialNumber) return "serialNumber es requerido";
    if (typeof body.serialNumber !== "string") return "serialNumber debe ser string";
    if (body.serialNumber.length < 3) return "serialNumber muy corto";
    if (body.serialNumber.length > 50) return "serialNumber muy largo";
    if (!/^[a-zA-Z0-9_-]+$/.test(body.serialNumber))
        return "serialNumber contiene caracteres inválidos";

    if (!body.sensorName) return "sensorName es requerido";
    if (typeof body.sensorName !== "string") return "sensorName debe ser string";
    if (body.sensorName.length < 2) return "sensorName muy corto";
    if (body.sensorName.length > 50) return "sensorName muy largo";

    if (body.customerName) {
        if (typeof body.customerName !== "string") return "customerName debe ser string";
        if (body.customerName.length < 2) return "customerName muy corto";
        if (body.customerName.length > 100) return "customerName muy largo";
    }

    // NUEVA VALIDACIÓN: userEmail (opcional)
    if (body.userEmail) {
        if (typeof body.userEmail !== "string") return "userEmail debe ser string";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.userEmail))
            return "userEmail debe ser un email válido";
    }

    return null;
}




// ================================
// ENDPOINTS
// ================================

// Home con métricas en tiempo real
app.get("/", (c) => {
    const stats = {
        cache: cache.getStats(),
        rateLimiting: globalRateLimit.getStatus(),
        concurrency: concurrencyController.getStats(),
        uptime: process.uptime(),
    };

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>TempLogger Pro - High Performance Provisioning</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { box-sizing: border-box; }
            body { font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
            .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); margin-top: 40px; }
            .header { text-align: center; margin-bottom: 40px; }
            .logo { font-size: 4em; margin-bottom: 10px; }
            h1 { color: #2d3748; margin: 0; font-weight: 700; }
            .subtitle { color: #4a5568; font-size: 1.1em; margin-top: 10px; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
            .stat-card { background: linear-gradient(135deg, #4299e1, #3182ce); color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 20px rgba(66, 153, 225, 0.3); }
            .stat-title { font-size: 0.9em; opacity: 0.9; margin-bottom: 8px; }
            .stat-value { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
            .stat-detail { font-size: 0.8em; opacity: 0.8; }
            .endpoint { background: #f7fafc; border: 1px solid #e2e8f0; padding: 20px; margin: 15px 0; border-radius: 10px; border-left: 4px solid #4299e1; }
            .method { font-weight: bold; color: #2b6cb0; font-size: 1.1em; font-family: 'SF Mono', Monaco, monospace; }
            .config { background: #fffbf0; border: 1px solid #f6e05e; padding: 20px; border-radius: 10px; margin: 20px 0; }
            .code { background: #2d3748; color: #e2e8f0; padding: 15px; border-radius: 8px; font-family: 'SF Mono', Monaco, monospace; overflow-x: auto; font-size: 0.9em; }
            .performance-badge { background: #48bb78; color: white; padding: 5px 10px; border-radius: 20px; font-size: 0.8em; margin-left: 10px; }
            h2 { color: #2d3748; border-bottom: 3px solid #4299e1; padding-bottom: 10px; margin-top: 40px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">iotana</div>
                <h1>TempLogger Pro <span class="performance-badge">HIGH PERFORMANCE</span></h1>
                <p class="subtitle">Sistema de Provisioning</p>
                <p><strong>Capacidad:</strong> 3200+ requests/hour | <strong>Uptime:</strong> ${Math.round(
        stats.uptime / 60
    )} min</p>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-title">Cache Performance</div>
                    <div class="stat-value">${stats.cache.hitRate}%</div>
                    <div class="stat-detail">${stats.cache.hits} hits, ${stats.cache.misses
        } misses</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">Rate Limiting</div>
                    <div class="stat-value">${stats.rateLimiting.remaining
        }</div>
                    <div class="stat-detail">Remaining requests this hour</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">Concurrency</div>
                    <div class="stat-value">${stats.concurrency.active}</div>
                    <div class="stat-detail">Active: ${stats.concurrency.active
        } | Queued: ${stats.concurrency.queued}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">ThingsBoard</div>
                    <div class="stat-value">✅</div>
                    <div class="stat-detail">${TB_CONFIG.host}</div>
                </div>
            </div>
            
            <div class="config">
                <h3>⚙️ Configuración ESP8266/ESP32</h3>
                <div class="code">
#define PROVISIONING_SERVER "${c.req.header("host") || "your-app.railway.app"
        }"<br>
#define PROVISIONING_PORT 443<br>
#define PROVISIONING_ENDPOINT "/api/v1/devices/provision"<br>
#define USE_HTTPS true  // Obligatorio para Railway
                </div>
            </div>
            
            <h2>Endpoints</h2>
            
            <div class="endpoint">
                <div class="method">POST /api/v1/devices/provision</div>
                <p>✅ <strong>Endpoint principal</strong> - Provisioning ultra-rápido con cache inteligente</p>
                <p><small>Soporta hasta 100 req/min por IP, 3500/hora global</small></p>
            </div>
            
            <div class="endpoint">
                <div class="method">GET /api/v1/devices</div>
                <p>Lista dispositivos con cache optimizado</p>
            </div>
            
            <div class="endpoint">
                <div class="method">GET /api/v1/customers</div>
                <p>Lista clientes con cache de alto rendimiento</p>
            </div>
            
            <div class="endpoint">
                <div class="method">GET /api/v1/stats</div>
                <p>Métricas detalladas de rendimiento en tiempo real</p>
            </div>
            
            <div class="endpoint">
                <div class="method">GET /api/health</div>
                <p>Health check con métricas de sistema</p>
            </div>
        </div>
        
        <script>
        // Auto-refresh stats every 30 seconds
        setTimeout(() => location.reload(), 30000);
        </script>
    </body>
    </html>
  `;

    return c.html(html);
});

// Health check mejorado
app.get("/api/health", async (c) => {
    const memUsage = process.memoryUsage();

    return c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        platform: "Railway + process",
        runtime: `process v${process.version}`,
        uptime: process.uptime(),
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + " MB",
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + " MB",
        },
        performance: {
            cache: cache.getStats(),
            rateLimiting: globalRateLimit.getStatus(),
            concurrency: concurrencyController.getStats(),
        },
        thingsboard: {
            host: TB_CONFIG.host,
            configured: !!TB_CONFIG.username && !!TB_CONFIG.password,
        },
    });
});

// Stats endpoint
app.get("/api/v1/stats", (c) => {
    return c.json({
        cache: cache.getStats(),
        rateLimiting: globalRateLimit.getStatus(),
        concurrency: concurrencyController.getStats(),
        config: {
            maxConcurrentRequests: PERFORMANCE_CONFIG.maxConcurrentRequests,
            cacheTimeout: PERFORMANCE_CONFIG.cacheTimeout,
            globalRateLimit: PERFORMANCE_CONFIG.globalRateLimit,
        },
        uptime: process.uptime(),
    });
});

// Test ThingsBoard con cache
app.get("/api/v1/test-tb", async (c) => {
    try {
        const cacheKey = "tb_test_user_info";
        let userInfo = cache.get(cacheKey);

        if (!userInfo) {
            const response = await httpClient.request("/api/auth/user");
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            userInfo = await response.json();
            cache.set(cacheKey, userInfo, 60000); // Cache 1min
        }

        return c.json({
            success: true,
            message: "Conexión exitosa con ThingsBoard",
            cached: !!cache.get(cacheKey),
            thingsboard: {
                host: TB_CONFIG.host,
                user: (userInfo as { email: string; authority: string }).email,
                authority: (userInfo as { email: string; authority: string }).authority,
            },
        });
    } catch (error) {
        return c.json(
            {
                success: false,
                message: "Error conectando con ThingsBoard",
                error: error instanceof Error ? error.message : "Unknown error",
            },
            500
        );
    }
});

// ENDPOINT PRINCIPAL DE PROVISIONING - ULTRA OPTIMIZADO
app.post("/api/v1/devices/provision", async (c) => {
    const startTime = Date.now();

    try {
        const body = await c.req.json();
        const validationError = validateProvisioningRequest(body);
        if (validationError) {
            return c.json({ success: false, message: validationError }, 400);
        }

        const {
            serialNumber,
            productName = "TempLogger",
            customerName,
            sensorName,
            userEmail,        // ← NUEVO PARÁMETRO
            createUser = true, // ← NUEVO: por defecto crear usuario
        } = body;

        const deviceName = `${productName}_${serialNumber}`;
        const finalCustomerName = customerName || determineCustomerName(serialNumber);

        console.log(`Starting provisioning: ${deviceName} for ${finalCustomerName}, sensor: ${sensorName}`);

        // Crear customer
        const customer = await customerService.getOrCreateWithIncrement(finalCustomerName);

        // Crear dispositivo
        const deviceResult = await deviceService.createOrGet(
            deviceName,
            serialNumber,
            customer,
            sensorName
        );

        // ✅ CREAR USUARIO SI SE SOLICITA Y HAY EMAIL
        let userResult: UserResult | null = null;
        if (createUser && userEmail) {
            try {
                userResult = await userService.createOrGetCustomerUser({
                    email: userEmail,
                    customerId: customer.id.id,
                    customerName: customer.title,
                    deviceName: deviceName,
                    sendEmail: true,
                });
                console.log(`✅ Usuario ${userResult.isExisting ? 'existente' : 'creado'}: ${userEmail}`);
            } catch (userError) {
                console.warn('⚠️ Error creando usuario, continuando provisioning:', userError);
                // No fallar todo el provisioning si falla el usuario
            }
        }

        // Crear dashboard
        let dashboard = null;
        if (TB_CONFIG.dashboardTemplateId) {
            try {
                dashboard = await dashboardService.cloneAndAssign(
                    deviceResult.device.id.id,
                    deviceName,
                    customer.id.id
                );
            } catch (dashError) {
                console.warn("Dashboard creation failed:", dashError);
            }
        }

        const processingTime = Date.now() - startTime;

        const response: any = {
            success: true,
            message: deviceResult.isExisting
                ? "Device found and configured"
                : "Device provisioned successfully",
            processingTime: `${processingTime}ms`,
            device: {
                id: deviceResult.device.id.id,
                name: deviceResult.device.name,
                token: deviceResult.credentials?.credentialsId || null,
                isExisting: deviceResult.isExisting,
            },
            customer: {
                id: customer.id.id,
                name: customer.title,
                isNewName: customer.title !== finalCustomerName,
            },
            ...(dashboard && {
                dashboard: {
                    id: dashboard.id.id,
                    title: dashboard.title,
                },
            }),
            metadata: {
                timestamp: new Date().toISOString(),
                serverLocation: "Railway",
                cached: deviceResult.isExisting,
                requestedCustomerName: finalCustomerName,
                finalCustomerName: customer.title,
            },
        };

        // ✅ AGREGAR INFO DEL USUARIO A LA RESPUESTA
        if (userResult) {
            response.user = {
                email: userEmail,
                isExisting: userResult.isExisting,
                emailSent: userResult.emailSent,
                ...(!userResult.isExisting && { password: userResult.password }), // Solo mostrar password de usuarios nuevos
            };
        }

        console.log(`Provisioning completed in ${processingTime}ms`);
        return c.json(response);
    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`Provisioning failed after ${processingTime}ms:`, error);

        return c.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Unknown provisioning error",
                processingTime: `${processingTime}ms`,
                timestamp: new Date().toISOString(),
            },
            500
        );
    }
});

// Listar dispositivos con paginación y cache
app.get("/api/v1/devices", async (c) => {
    try {
        const page = parseInt(c.req.query("page") || "0");
        const pageSize = Math.min(parseInt(c.req.query("pageSize") || "20"), 100);
        const search = c.req.query("search") || "";

        const cacheKey = `devices:${page}:${pageSize}:${search}`;
        let cached = cache.get(cacheKey);

        if (cached) {
            return c.json({ ...cached, cached: true });
        }

        let endpoint = `/api/tenant/devices?pageSize=${pageSize}&page=${page}`;
        if (search) {
            endpoint += `&textSearch=${encodeURIComponent(search)}`;
        }

        const response = await httpClient.request(endpoint);

        if (!response.ok) {
            throw new Error(`Error fetching devices: ${response.statusText}`);
        }

        const data = await response.json();
        const devices = data.data.map((device: any) => ({
            id: device.id.id,
            name: device.name,
            label: device.label,
            type: device.type,
            createdTime: new Date(device.createdTime).toISOString(),
            additionalInfo: device.additionalInfo,
        }));

        const result = {
            success: true,
            count: devices.length,
            totalElements: data.totalElements,
            totalPages: data.totalPages,
            currentPage: page,
            devices,
            cached: false,
        };

        cache.set(cacheKey, result, 120000); // Cache 2min
        return c.json(result);
    } catch (error) {
        console.error("Error fetching devices:", error);
        return c.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Unknown error",
            },
            500
        );
    }
});

// Listar clientes con cache
app.get("/api/v1/customers", async (c) => {
    try {
        const cacheKey = "customers_list";
        let cached = cache.get(cacheKey);

        if (cached) {
            return c.json({ ...cached, cached: true });
        }

        const response = await httpClient.request(
            "/api/customers?pageSize=100&page=0"
        );

        if (!response.ok) {
            throw new Error(`Error fetching customers: ${response.statusText}`);
        }

        const data = await response.json();
        const customers = data.data.map((customer: any) => ({
            id: customer.id.id,
            title: customer.title,
            createdTime: new Date(customer.createdTime).toISOString(),
            additionalInfo: customer.additionalInfo,
        }));

        const result = {
            success: true,
            count: customers.length,
            customers,
            cached: false,
        };

        cache.set(cacheKey, result, 300000); // Cache 5min
        return c.json(result);
    } catch (error) {
        console.error("Error fetching customers:", error);
        return c.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Unknown error",
            },
            500
        );
    }
});

// Obtener dispositivo específico con cache
app.get("/api/v1/devices/:serialNumber", async (c) => {
    try {
        const serialNumber = c.req.param("serialNumber");
        const cacheKey = `device_detail:${serialNumber}`;

        let cached = cache.get(cacheKey);
        if (cached) {
            return c.json({ ...cached, cached: true });
        }

        const searchResponse = await httpClient.request(
            `/api/tenant/devices?pageSize=100&page=0&textSearch=${encodeURIComponent(
                serialNumber
            )}`
        );

        if (!searchResponse.ok) {
            throw new Error(`Error searching device: ${searchResponse.statusText}`);
        }

        const searchData = await searchResponse.json();
        const device = searchData.data.find((d: any) => d.label === serialNumber);

        if (!device) {
            return c.json({ success: false, message: "Device not found" }, 404);
        }

        // Obtener credenciales en paralelo
        const credentialsResponse = await httpClient.request(
            `/api/device/${device.id.id}/credentials`
        );

        const credentials = credentialsResponse.ok
            ? await credentialsResponse.json()
            : null;

        const result = {
            success: true,
            device: { ...device, credentials },
            cached: false,
        };

        cache.set(cacheKey, result, 300000); // Cache 5min
        return c.json(result);
    } catch (error) {
        console.error("Error fetching device:", error);
        return c.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Unknown error",
            },
            500
        );
    }
});

// Eliminar dispositivo y limpiar cache
app.delete("/api/v1/devices/:deviceId", async (c) => {
    try {
        const deviceId = c.req.param("deviceId");

        const response = await httpClient.request(`/api/device/${deviceId}`, {
            method: "DELETE",
        });

        if (!response.ok) {
            throw new Error(`Error deleting device: ${response.statusText}`);
        }

        // Limpiar cache relacionado
        cache.delete(`device_detail:${deviceId}`);
        // Invalidar cache de lista de dispositivos
        for (const key of Array.from((cache as any).cache.keys())) {
            const k = key as string;
            if (k.startsWith("devices:")) {
                cache.delete(k);
            }
        }

        console.log(`🗑️ Device ${deviceId} deleted`);
        return c.json({
            success: true,
            message: "Device deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting device:", error);
        return c.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Unknown error",
            },
            500
        );
    }
});

// Endpoint para limpiar cache manualmente
app.post("/api/v1/cache/clear", (c) => {
    const oldStats = cache.getStats();
    cache.clear();

    return c.json({
        success: true,
        message: "Cache cleared successfully",
        previousStats: oldStats,
        newStats: cache.getStats(),
    });
});

// Endpoint de provisioning masivo (para testing de carga)
app.post("/api/v1/devices/provision/batch", async (c) => {
    try {
        const body = await c.req.json();
        const { devices, customerOverride } = body;

        if (!Array.isArray(devices) || devices.length === 0) {
            return c.json(
                { success: false, message: "devices array is required" },
                400
            );
        }

        if (devices.length > 50) {
            return c.json(
                { success: false, message: "Maximum 50 devices per batch" },
                400
            );
        }

        const startTime = Date.now();
        const results: any[] = [];
        const errors: any[] = [];


        // Procesar en chunks para evitar sobrecarga
        const chunkSize = 10;
        for (let i = 0; i < devices.length; i += chunkSize) {
            const chunk = devices.slice(i, i + chunkSize);

            const chunkResults = await Promise.allSettled(
                chunk.map(async (deviceData) => {
                    const { serialNumber, productName = "TempLogger" } = deviceData;
                    const deviceName = `${productName}_${serialNumber}`;
                    const customerName =
                        customerOverride || determineCustomerName(serialNumber);

                    const customer = await customerService.getOrCreate(customerName);
                    const deviceResult = await deviceService.createOrGet(
                        deviceName,
                        serialNumber,
                        customer
                    );

                    return {
                        serialNumber,
                        device: {
                            id: deviceResult.device.id.id,
                            name: deviceResult.device.name,
                            token: deviceResult.credentials?.credentialsId,
                            isExisting: deviceResult.isExisting,
                        },
                        customer: {
                            id: customer.id.id,
                            name: customer.title,
                        },
                    };
                })
            );

            chunkResults.forEach((result, idx) => {
                if (result.status === "fulfilled") {
                    results.push(result.value);
                } else {
                    errors.push({
                        serialNumber: chunk[idx]?.serialNumber || "unknown",
                        error:
                            result.reason instanceof Error
                                ? result.reason.message
                                : "Unknown error",
                    });
                }
            });
        }

        const processingTime = Date.now() - startTime;

        return c.json({
            success: true,
            message: `Batch provisioning completed`,
            processingTime: `${processingTime}ms`,
            stats: {
                total: devices.length,
                successful: results.length,
                failed: errors.length,
            },
            results,
            errors,
        });
    } catch (error) {
        console.error("Batch provisioning error:", error);
        return c.json(
            {
                success: false,
                message:
                    error instanceof Error ? error.message : "Batch provisioning failed",
            },
            500
        );
    }
});

// ================================
// INICIALIZACIÓN DEL SERVIDOR
// ================================

console.log("   Provisioning Server");
console.log("=".repeat(60));
console.log(`   Configuration:`);
console.log(`   Runtime: process v${process.version}`);
console.log(`   ThingsBoard: ${TB_CONFIG.host}:${TB_CONFIG.port}`);
console.log(`   Max Concurrent: ${PERFORMANCE_CONFIG.maxConcurrentRequests}`);
console.log(`   Global Rate Limit: ${PERFORMANCE_CONFIG.globalRateLimit}/hour`);
console.log(`   Cache Timeout: ${PERFORMANCE_CONFIG.cacheTimeout / 1000}s`);
console.log(`   Request Timeout: ${TB_CONFIG.requestTimeout / 1000}s`);

// Test inicial de conectividad (no bloqueante)
httpClient
    .authenticate()
    .then(() => console.log("✅ Initial ThingsBoard connection successful"))
    .catch(() =>
        console.log(
            "⚠️  Initial ThingsBoard connection failed - will retry on demand"
        )
    );

// Configuración del servidor con optimizaciones
const port = parseInt(process.env.PORT || '15182', 10)
const hostname = '0.0.0.0'

// Iniciar servidor (no hace falta tipar explícitamente)
const server = serve({
    fetch: app.fetch,
    port,
    hostname,
})

console.log(`✅ Server running at http://${hostname}:${port}`)

// Manejo global de errores
process.on('uncaughtException', (error: unknown): void => {
    console.error('🔴 Uncaught exception:', error)
})

process.on('unhandledRejection', (reason: unknown): void => {
    console.error('🔴 Unhandled rejection:', reason)
})

console.log("=".repeat(60));
console.log(`   Server running on port ${port}`);
console.log(`   URL: http://localhost:${port}`);
console.log("=".repeat(60));
// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑 Received SIGINT, shutting down gracefully...");
    server.close(() => {
        console.log('✅ Server stopped');
    });
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
    server.close(() => {
        console.log('✅ Server stopped');
    });
    process.exit(0);
});
