import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. CONFIGURACIÓN DE AZURE SQL DATABASE
// ==========================================
const dbConfig = {
    user: process.env.DB_USER || process.env.SQL_USER,
    password: process.env.DB_PASSWORD || process.env.SQL_PASSWORD,
    server: process.env.DB_SERVER || process.env.SQL_SERVER,
    database: process.env.DB_DATABASE || process.env.SQL_DATABASE,
    options: {
        encrypt: true, // Obligatorio para Azure SQL
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
// 2. CONFIGURACIÓN DE DEEPSEEK API DIRECTA
// ==========================================
// Si el .env tiene el placeholder terminado en "seek", fuerza el uso de tu API Key real
const envKey = (process.env.DEEPSEEK_API_KEY || '').trim();
const apiKeyDeepSeek = (!envKey || envKey.endsWith('seek'))
    ? 'sk-5543dea9551f452fba9e5473749bc344'
    : envKey;

const deepseek = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: apiKeyDeepSeek,
});

// ==========================================
// 3. DEFINICIÓN DE HERRAMIENTAS (MCP & LLM)
// ==========================================
const mcpTools = [
    {
        name: 'obtener_esquema_bd',
        description:
            'Obtiene la lista de tablas y columnas de la base de datos Azure SQL del ERP. Úsala SIEMPRE primero si no conoces el nombre exacto de las tablas o columnas.',
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

// Adaptador automático del esquema MCP al formato de Tools de DeepSeek/OpenAI
const openAiTools = mcpTools.map((tool) => ({
    type: 'function',
    function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
    },
}));

// Lógica central de ejecución de herramientas contra Azure SQL
async function executeMcpTool(name, args) {
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
        const sqlQuery = (args?.query || '').trim();

        // Guardrail de seguridad: bloquear cualquier comando que no sea SELECT o CTE (WITH)
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
                datos: result.recordset.slice(0, 150),
            });
        } catch (sqlError) {
            return JSON.stringify({
                error_sql: sqlError.message,
                sugerencia: 'Verifica los nombres de columnas con obtener_esquema_bd y recuerda usar sintaxis T-SQL (ej. SELECT TOP 10 en vez de LIMIT 10).',
            });
        }
    }

    throw new Error(`Herramienta no encontrada: ${name}`);
}

// ==========================================
// 4. SERVIDOR MCP NATIVO
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
// 5. ENDPOINT PARA EL CHATBOT DEL FRONTEND
// ==========================================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'El mensaje es obligatorio.' });
        }

        const systemPrompt = `Eres Protemec Intelligence, el analista de datos e inteligencia artificial integrado en el ERP de PROTEMEC.
Tienes acceso directo en tiempo real a la base de datos Azure SQL mediante herramientas MCP.

Reglas de operación:
1. Si no conoces las tablas o columnas necesarias para responder, ejecuta primero 'obtener_esquema_bd'.
2. Usa sintaxis T-SQL de Microsoft SQL Server (usa TOP N, GETDATE(), DATEADD, etc., NUNCA uses LIMIT).
3. Analiza los datos obtenidos y entrega respuestas ejecutivas, claras, con métricas exactas en pesos mexicanos (MXN) cuando aplique, y bien estructuradas en Markdown (tablas o listas).
4. Si un cálculo o cruce de datos se puede hacer en SQL (SUM, COUNT, AVG, GROUP BY), hazlo directamente en la consulta para ahorrar tokens y ser exacto.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: message },
        ];

        let iterations = 0;
        const MAX_ITERATIONS = 5;

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            const response = await deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: messages,
                tools: openAiTools,
                tool_choice: 'auto',
                temperature: 0.1,
            });

            const assistantMessage = response.choices[0].message;
            messages.push(assistantMessage);

            // Si DeepSeek ya tiene la respuesta final y no requiere más consultas SQL, la enviamos al frontend
            if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                return res.json({
                    reply: assistantMessage.content,
                    iterations_used: iterations,
                    usage: response.usage,
                });
            }

            // Ejecutar las herramientas MCP solicitadas por DeepSeek
            for (const toolCall of assistantMessage.tool_calls) {
                const toolName = toolCall.function.name;
                const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

                console.log(`[MCP Tool Execution] -> ${toolName}:`, toolArgs);

                const toolResult = await executeMcpTool(toolName, toolArgs);

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolResult,
                });
            }
        }

        return res.json({
            reply: 'Se alcanzó el límite de consultas internas para esta pregunta. Por favor, intenta ser más específico.',
        });
    } catch (error) {
        console.error('Error en /api/chat:', error);
        res.status(500).json({
            error: 'Error procesando la solicitud con DeepSeek y Azure SQL.',
            details: error.message,
        });
    }
});

// Puerto fijo en 3001 para no colisionar con el puerto 3000 de server.js
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`✅ Servidor ERP + MCP + DeepSeek activo en http://localhost:${PORT}`);
    console.log(`🔑 API Key DeepSeek cargada (termina en: ...${apiKeyDeepSeek.slice(-4)})`);
});