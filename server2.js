import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import dotenv from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

// ==========================================
// 1. CONFIGURACIÓN DE AZURE SQL DATABASE
// ==========================================
const dbConfig = {
    user: process.env.DB_USER || process.env.SQL_USER || 'adminprote',
    password: process.env.DB_PASSWORD || process.env.SQL_PASSWORD || 'ProtemecAdmin@',
    server: process.env.DB_SERVER || process.env.SQL_SERVER || 'dbprotemec.database.windows.net',
    database: process.env.DB_DATABASE || process.env.SQL_DATABASE || 'Protemec',
    options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000,
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
    },
};

let poolPromise;
const getDbPool = async () => {
    if (!poolPromise) {
        poolPromise = sql.connect(dbConfig).catch((err) => {
            console.error('Error conectando a Azure SQL:', err);
            poolPromise = null;
            throw err;
        });
    }
    return poolPromise;
};

// ==========================================
// 2. CONFIGURACIÓN DE GEMINI API (FREE TIER OPTIMIZADO)
// ==========================================
const apiKeyGemini = (process.env.GEMINI_API_KEY || '').trim();
const geminiModel = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();

// ==========================================
// 3. CACHÉ DE ESQUEMA SQL (AHORRA LLAMADAS EN CAPA FREE)
// ==========================================
let esquemaCache = null;
let esquemaCacheTimestamp = 0;
const ESQUEMA_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

async function obtenerResumenEsquemaEnMemoria() {
    const ahora = Date.now();
    if (esquemaCache && ahora - esquemaCacheTimestamp < ESQUEMA_CACHE_TTL_MS) {
        return esquemaCache;
    }

    try {
        const pool = await getDbPool();
        const result = await pool.request().query(`
            SELECT 
                t.TABLE_NAME AS Tabla,
                c.COLUMN_NAME AS Columna,
                c.DATA_TYPE AS TipoDato
            FROM INFORMATION_SCHEMA.TABLES t
            INNER JOIN INFORMATION_SCHEMA.COLUMNS c 
                ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
            WHERE t.TABLE_TYPE = 'BASE TABLE'
            ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
        `);

        const tablasMap = {};
        for (const row of result.recordset) {
            if (!tablasMap[row.Tabla]) {
                tablasMap[row.Tabla] = [];
            }
            tablasMap[row.Tabla].push(`${row.Columna} (${row.TipoDato})`);
        }

        const lineas = Object.entries(tablasMap).map(
            ([tabla, cols]) => `- ${tabla}: ${cols.join(', ')}`
        );

        esquemaCache = lineas.join('\n');
        esquemaCacheTimestamp = ahora;
        return esquemaCache;
    } catch (err) {
        console.warn('⚠️ No se pudo precargar el esquema SQL en caché:', err.message);
        return null;
    }
}

// ==========================================
// 4. DEFINICIÓN DE HERRAMIENTAS (MCP & GEMINI)
// ==========================================
const mcpTools = [
    {
        name: 'obtener_esquema_bd',
        description:
            'Obtiene la lista de tablas y columnas de la base de datos Azure SQL del ERP. Úsala solo si el esquema proporcionado en el prompt no incluye la tabla que buscas.',
        inputSchema: {
            type: 'object',
            properties: {
                filtro_tabla: {
                    type: 'string',
                    description: 'Opcional. Nombre parcial de la tabla para filtrar (ej. "Compras", "Proyectos", "Inventario").',
                },
            },
        },
    },
    {
        name: 'ejecutar_consulta_sql',
        description:
            'Ejecuta una consulta T-SQL de SOLO LECTURA (SELECT) en Azure SQL Database para obtener datos en tiempo real del ERP.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Consulta T-SQL válida (solo SELECT). Usa TOP en lugar de LIMIT.',
                },
            },
            required: ['query'],
        },
    },
];

// Declaración de herramientas en formato nativo de Gemini API
const geminiFunctionDeclarations = mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
}));

async function executeMcpTool(name, args) {
    try {
        const pool = await getDbPool();

        if (name === 'obtener_esquema_bd') {
            let query = `
                SELECT 
                    t.TABLE_SCHEMA AS Esquema,
                    t.TABLE_NAME AS Tabla,
                    c.COLUMN_NAME AS Columna,
                    c.DATA_TYPE AS TipoDato
                FROM INFORMATION_SCHEMA.TABLES t
                INNER JOIN INFORMATION_SCHEMA.COLUMNS c 
                    ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
                WHERE t.TABLE_TYPE = 'BASE TABLE'
            `;

            const request = pool.request();
            if (args?.filtro_tabla) {
                query += ` AND t.TABLE_NAME LIKE @filtro`;
                request.input('filtro', sql.NVarChar, `%${args.filtro_tabla}%`);
            }
            query += ` ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`;

            const result = await request.query(query);
            return JSON.stringify(result.recordset);
        }

        if (name === 'ejecutar_consulta_sql') {
            const sqlQuery = (args?.query || '').trim().replace(/;+\s*$/, '');
            const isSelect = /^(SELECT|WITH)\b/i.test(sqlQuery);
            const hasForbiddenKeywords = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|EXEC|EXECUTE|MERGE|GRANT|REVOKE)\b/i.test(sqlQuery);

            if (!isSelect || hasForbiddenKeywords) {
                return JSON.stringify({
                    error: 'Operación bloqueada por seguridad: Solo se permiten consultas de lectura (SELECT).',
                });
            }

            try {
                const result = await pool.request().query(sqlQuery);
                return JSON.stringify({
                    filas_afectadas: result.recordset.length,
                    datos: result.recordset.slice(0, 100),
                });
            } catch (sqlError) {
                return JSON.stringify({
                    error_sql: sqlError.message,
                    sugerencia: 'Revisa los nombres exactos de tablas y columnas en el esquema proporcionado y usa sintaxis T-SQL (SELECT TOP N en lugar de LIMIT).',
                });
            }
        }

        return JSON.stringify({ error: `Herramienta no encontrada: ${name}` });
    } catch (dbErr) {
        console.error(`Error ejecutando herramienta MCP (${name}):`, dbErr.message);
        return JSON.stringify({
            error_conexion_bd: dbErr.message,
        });
    }
}

// ==========================================
// 5. CLIENTE NATIVO GEMINI REST (SOPORTA GEMINI 2.5 FLASH + FALLBACK POR 503)
// ==========================================
const MODELOS_FALLBACK_FREE = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ejecutarPeticionGemini(modelo, body) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKeyGemini)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
}

async function llamarGeminiGenerateContent({ systemPrompt, contents, allowTools = true, modeloPreferido = geminiModel }) {
    if (!apiKeyGemini) {
        throw new Error('Falta configurar la variable de entorno GEMINI_API_KEY en el servidor.');
    }

    const body = {
        systemInstruction: {
            parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
            temperature: 0.1,
        },
    };

    if (allowTools) {
        body.tools = [{ functionDeclarations: geminiFunctionDeclarations }];
        body.toolConfig = {
            functionCallingConfig: {
                mode: 'AUTO',
            },
        };
    }

    // Lista sin duplicados: primero el modelo preferido, luego los respaldos gratuitos en caso de saturación (503)
    const candidatos = [...new Set([modeloPreferido, ...MODELOS_FALLBACK_FREE])];
    let ultimoError = null;

    for (let idx = 0; idx < candidatos.length; idx++) {
        const modeloActual = candidatos[idx];
        const { res, data } = await ejecutarPeticionGemini(modeloActual, body);

        if (res.ok) {
            return { data, modeloUsado: modeloActual };
        }

        const msg = data?.error?.message || `HTTP ${res.status} al llamar a Gemini API`;
        const status = data?.error?.status || res.status;

        // Si el modelo está saturado temporalmente (503), esperamos brevemente y probamos el siguiente modelo gratuito
        if (res.status === 503) {
            console.warn(`⚠️ ${modeloActual} devolvió 503 (alta demanda). Probando respaldo...`);
            ultimoError = new Error(`Servidores gratuitos de Gemini saturados temporalmente (503 UNAVAILABLE): ${msg}`);
            if (idx < candidatos.length - 1) {
                await esperar(800);
                continue;
            }
            throw ultimoError;
        }

        if (res.status === 429) {
            throw new Error(`Límite de cuota gratuita de Gemini alcanzado (429 RESOURCE_EXHAUSTED). Espera unos segundos antes de enviar otra consulta. Detalle: ${msg}`);
        }

        throw new Error(`Error de Gemini API (${status}): ${msg}`);
    }

    throw ultimoError || new Error('No se pudo obtener respuesta de Gemini API.');
}

// ==========================================
// 6. SERVIDOR MCP NATIVO
// ==========================================
const mcpServer = new Server(
    { name: 'protemec-erp-azure-sql-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools,
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const output = await executeMcpTool(request.params.name, request.params.arguments);
        return { content: [{ type: 'text', text: output }] };
    } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
});

// ==========================================
// 7. ENDPOINTS DE SALUD Y CHATBOT DEL FRONTEND
// ==========================================
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'Protemec Intelligence - Servidor MCP + Gemini Flash + Azure SQL',
        model: geminiModel,
        endpoints: ['POST /api/chat', 'GET /api/health'],
    });
});

app.get('/api/health', async (req, res) => {
    try {
        const pool = await getDbPool();
        await pool.request().query('SELECT 1 AS ok');
        res.json({
            status: 'ok',
            database: 'connected',
            llm: geminiModel,
            apiKeyConfigured: Boolean(apiKeyGemini),
        });
    } catch (err) {
        res.status(500).json({ status: 'error', database: 'disconnected', details: err.message });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'El mensaje es obligatorio.' });
        }

        // Precargamos el esquema desde caché en RAM (0 llamadas extra a Gemini API)
        const esquemaTexto = await obtenerResumenEsquemaEnMemoria();

        const systemPrompt = `Eres Protemec Intelligence, el analista de datos e inteligencia artificial integrado en el ERP de PROTEMEC.
Tienes acceso directo en tiempo real a la base de datos Azure SQL mediante la herramienta 'ejecutar_consulta_sql'.

${esquemaTexto ? `ESQUEMA ACTUAL DE TABLAS Y COLUMNAS EN AZURE SQL (YA CARGADO, NO LLAMES A obtener_esquema_bd A MENOS QUE FALTE ALGO):\n${esquemaTexto}\n` : ''}
Reglas de operación:
1. Usa directamente 'ejecutar_consulta_sql' con los nombres exactos de tablas y columnas del esquema anterior para ahorrar llamadas a la API.
2. Usa sintaxis T-SQL de Microsoft SQL Server (usa TOP N, GETDATE(), DATEADD, ISNULL, etc., NUNCA uses LIMIT).
3. Si un cálculo o cruce de datos se puede hacer en SQL (SUM, COUNT, AVG, GROUP BY), hazlo directamente en la consulta para ahorrar tokens y ser exacto.
4. Analiza los datos obtenidos y entrega respuestas ejecutivas en español, claras, con métricas exactas en pesos mexicanos (MXN) cuando aplique, y bien estructuradas en Markdown (tablas o listas).`;

        // Convertimos el historial al formato nativo de Gemini (user / model)
        const contents = [];
        for (const item of history) {
            if (!item?.content) continue;
            const role = item.role === 'assistant' || item.role === 'model' ? 'model' : 'user';
            contents.push({
                role,
                parts: [{ text: String(item.content) }],
            });
        }

        contents.push({
            role: 'user',
            parts: [{ text: String(message) }],
        });

        let iterations = 0;
        // Máximo 2 rondas de herramientas + 1 respuesta final para cuidar la cuota gratuita (Free Tier)
        const MAX_ITERATIONS = 3;
        let totalTokensAcumulados = 0;
        let modeloActivoEnChat = geminiModel;

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            // En la última iteración deshabilitamos herramientas para forzar respuesta de texto final
            const allowTools = iterations < MAX_ITERATIONS;
            const { data: responseData, modeloUsado } = await llamarGeminiGenerateContent({
                systemPrompt,
                contents,
                allowTools,
                modeloPreferido: modeloActivoEnChat,
            });
            modeloActivoEnChat = modeloUsado;

            if (responseData?.usageMetadata?.totalTokenCount) {
                totalTokensAcumulados += responseData.usageMetadata.totalTokenCount;
            }

            const candidate = responseData?.candidates?.[0];
            const modelContent = candidate?.content;
            const parts = modelContent?.parts || [];

            if (!parts.length) {
                const razonBloqueo = candidate?.finishReason || responseData?.promptFeedback?.blockReason || 'Respuesta vacía del modelo';
                return res.json({
                    reply: `No se pudo generar respuesta en este intento (${razonBloqueo}). Intenta reformular tu consulta.`,
                    model: modeloActivoEnChat,
                    iterations_used: iterations,
                    usage: { total_tokens: totalTokensAcumulados },
                });
            }

            // Conservamos intacto el mensaje del modelo (incluyendo thoughtSignature en Gemini 2.5)
            contents.push({
                role: 'model',
                parts,
            });

            // Buscamos si el modelo solicitó ejecutar alguna función/herramienta MCP
            const functionCalls = parts.filter((p) => p.functionCall);

            if (functionCalls.length === 0) {
                const replyText = parts
                    .filter((p) => typeof p.text === 'string' && !p.thought)
                    .map((p) => p.text)
                    .join('\n')
                    .trim();

                return res.json({
                    reply: replyText || parts.map((p) => p.text || '').join('\n').trim() || 'Consulta completada.',
                    model: modeloActivoEnChat,
                    iterations_used: iterations,
                    usage: { total_tokens: totalTokensAcumulados },
                });
            }

            // Ejecutamos las herramientas solicitadas y agregamos sus functionResponse
            const responseParts = [];
            for (const part of functionCalls) {
                const { name: toolName, args: toolArgs } = part.functionCall;
                console.log(`[MCP Tool Execution] -> ${toolName}:`, toolArgs);

                const rawResult = await executeMcpTool(toolName, toolArgs || {});
                let parsedResult;
                try {
                    parsedResult = JSON.parse(rawResult);
                } catch {
                    parsedResult = { resultado: rawResult };
                }

                responseParts.push({
                    functionResponse: {
                        name: toolName,
                        response: Array.isArray(parsedResult)
                            ? { registros: parsedResult }
                            : parsedResult,
                    },
                });
            }

            contents.push({
                role: 'user',
                parts: responseParts,
            });
        }

        return res.json({
            reply: 'Se alcanzó el límite de pasos para esta consulta. Por favor intenta hacer una pregunta más específica.',
            iterations_used: iterations,
            usage: { total_tokens: totalTokensAcumulados },
        });
    } catch (error) {
        console.error('Error en /api/chat:', error.message);
        res.status(500).json({
            error: 'Error procesando la solicitud con Gemini y Azure SQL.',
            details: error.message,
        });
    }
});

// En local usa CHAT_PORT (3001) para no chocar con server.js (3000); en Azure App Service usa process.env.PORT
const PORT = process.env.CHAT_PORT || (process.env.WEBSITE_SITE_NAME ? process.env.PORT : 3001) || 3001;
app.listen(PORT, () => {
    console.log(`✅ Servidor ERP + MCP + Gemini (${geminiModel}) activo en http://localhost:${PORT}`);
});
