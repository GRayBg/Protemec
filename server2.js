import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import OpenAI from 'openai';
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
// 2. CONFIGURACIÓN DE PROVEEDORES IA (GEMINI & DEEPSEEK)
// ==========================================
const apiKeyGemini = (process.env.GEMINI_API_KEY || '').trim();
const geminiModel = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();

const apiKeyDeepSeek = (process.env.DEEPSEEK_API_KEY || '').trim();
const deepseekModel = (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
const deepseekClient = apiKeyDeepSeek
    ? new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: apiKeyDeepSeek })
    : null;

// ==========================================
// 3. CACHÉ DE ESQUEMA SQL Y PERMISOS RBAC DE IA
// ==========================================
let esquemaMapCache = null;
let esquemaCacheTimestamp = 0;
const ESQUEMA_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

async function obtenerEsquemaMapEnMemoria() {
    const ahora = Date.now();
    if (esquemaMapCache && ahora - esquemaCacheTimestamp < ESQUEMA_CACHE_TTL_MS) {
        return esquemaMapCache;
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

        esquemaMapCache = tablasMap;
        esquemaCacheTimestamp = ahora;
        return esquemaMapCache;
    } catch (err) {
        console.warn('⚠️ No se pudo precargar el esquema SQL en caché:', err.message);
        return null;
    }
}

async function obtenerResumenEsquemaEnMemoria(permisosIA = null) {
    const tablasMap = await obtenerEsquemaMapEnMemoria();
    if (!tablasMap) return null;

    const permitidasSet =
        permisosIA && !permisosIA.accesoTotalTablas
            ? new Set((permisosIA.tablasPermitidas || []).map((t) => String(t).toLowerCase()))
            : null;

    const lineas = Object.entries(tablasMap)
        .filter(([tabla]) => !permitidasSet || permitidasSet.has(tabla.toLowerCase()))
        .map(([tabla, cols]) => `- ${tabla}: ${cols.join(', ')}`);

    return lineas.join('\n');
}

async function obtenerPermisosIAUsuario({ userId, usuario, esMaestro }) {
    const permisosPorDefecto = {
        accesoTotalTablas: true,
        tablasPermitidas: [],
        busquedaEnLinea: false,
    };

    try {
        const pool = await getDbPool();
        let result = null;

        if (userId !== null && userId !== undefined && !Number.isNaN(Number(userId))) {
            result = await pool
                .request()
                .input('Id', sql.Int, Number(userId))
                .query('SELECT TOP 1 Id, EsMaestro, PermisosJSON FROM Usuarios WHERE Id = @Id');
        } else if (usuario) {
            result = await pool
                .request()
                .input('Usuario', sql.NVarChar, String(usuario).trim())
                .query('SELECT TOP 1 Id, EsMaestro, PermisosJSON FROM Usuarios WHERE LOWER(Usuario) = LOWER(@Usuario)');
        }

        const fila = result?.recordset?.[0];
        if (!fila) {
            return esMaestro ? { ...permisosPorDefecto, busquedaEnLinea: true } : permisosPorDefecto;
        }

        if (fila.EsMaestro) {
            return { accesoTotalTablas: true, tablasPermitidas: [], busquedaEnLinea: true };
        }

        const permisosObj = JSON.parse(fila.PermisosJSON || '{}');
        const ia = permisosObj?.ia || {};

        return {
            accesoTotalTablas: ia.accesoTotalTablas !== false,
            tablasPermitidas: Array.isArray(ia.tablasPermitidas) ? ia.tablasPermitidas : [],
            busquedaEnLinea: Boolean(ia.busquedaEnLinea),
        };
    } catch (err) {
        console.warn('⚠️ No se pudieron leer permisos IA desde SQL, usando respaldo:', err.message);
        return permisosPorDefecto;
    }
}

function validarTablasEnConsultaSQL(sqlQuery, tablasPermitidas = []) {
    if (/\b(INFORMATION_SCHEMA|SYSOBJECTS|SYSCOLUMNS|SYS\.)\b/i.test(sqlQuery)) {
        return {
            valido: false,
            error: 'Acceso bloqueado: Tu perfil tiene restricciones de tablas y no puede consultar vistas del sistema.',
        };
    }

    // Extraemos nombres de CTEs (WITH nombre AS (...)) para no confundirlos con tablas físicas
    const cteNames = new Set();
    const cteRegex = /\b(?:WITH|,)\s+([a-zA-Z0-9_[\]]+)\s+AS\s*\(/gi;
    let cteMatch;
    while ((cteMatch = cteRegex.exec(sqlQuery)) !== null) {
        cteNames.add(cteMatch[1].replace(/[[\]]/g, '').toLowerCase());
    }

    const permitidasSet = new Set(tablasPermitidas.map((t) => String(t).toLowerCase()));
    const tablaRegex = /\b(?:FROM|JOIN)\s+([a-zA-Z0-9_.\[\]]+)/gi;
    let match;
    while ((match = tablaRegex.exec(sqlQuery)) !== null) {
        let nombreTabla = match[1].trim();
        if (nombreTabla.startsWith('(')) continue;
        // Quitamos esquema (dbo.) y corchetes ([Tabla])
        const partes = nombreTabla.split('.');
        const tablaLimpia = partes[partes.length - 1].replace(/[[\]]/g, '');
        const tablaLower = tablaLimpia.toLowerCase();

        if (cteNames.has(tablaLower)) continue;
        if (!permitidasSet.has(tablaLower)) {
            return {
                valido: false,
                error: `Acceso denegado: Tu perfil no tiene permiso para consultar la tabla "${tablaLimpia}".`,
            };
        }
    }

    return { valido: true };
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

// Declaración de herramientas en formato OpenAI / DeepSeek
const openAiTools = mcpTools.map((tool) => ({
    type: 'function',
    function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
    },
}));

async function executeMcpTool(name, args, permisosIA = null) {
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
            let filas = result.recordset;

            if (permisosIA && !permisosIA.accesoTotalTablas) {
                const permitidasSet = new Set((permisosIA.tablasPermitidas || []).map((t) => String(t).toLowerCase()));
                filas = filas.filter((r) => permitidasSet.has(String(r.Tabla).toLowerCase()));
            }

            return JSON.stringify(filas);
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

            if (permisosIA && !permisosIA.accesoTotalTablas) {
                const validacion = validarTablasEnConsultaSQL(sqlQuery, permisosIA.tablasPermitidas || []);
                if (!validacion.valido) {
                    return JSON.stringify({ error: validacion.error });
                }
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
// 5. CLIENTE NATIVO GEMINI REST (CON REINTENTO EXPONENCIAL Y MODELOS LITE ANTE 503)
// ==========================================
// Modelos gratuitos de alta cuota (Lite) para evitar límites y saturación
const MODELOS_FALLBACK_FREE = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
];

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

    const candidatos = [...new Set([modeloPreferido, ...MODELOS_FALLBACK_FREE])];
    let ultimoError = null;

    for (let idx = 0; idx < candidatos.length; idx++) {
        const modeloActual = candidatos[idx];

        // Intentamos hasta 2 veces con el modelo si devuelve 503 (con backoff de 1.5s)
        for (let intento = 1; intento <= 2; intento++) {
            const { res, data } = await ejecutarPeticionGemini(modeloActual, body);

            if (res.ok) {
                return { data, modeloUsado: modeloActual };
            }

            const msg = data?.error?.message || `HTTP ${res.status} al llamar a Gemini API`;
            const status = data?.error?.status || res.status;

            if (res.status === 503) {
                console.warn(`⚠️ ${modeloActual} devolvió 503 (alta demanda, intento ${intento}/2).`);
                ultimoError = new Error(`Los servidores gratuitos de Gemini están experimentando alta demanda en este momento (503 UNAVAILABLE). Por favor espera unos segundos y pulsa 'Reintentar'.`);

                if (intento < 2) {
                    await esperar(1500);
                    continue;
                }
                // Si el modelo principal agotó sus 2 intentos, pasamos al siguiente modelo de la lista
                break;
            }

            if (res.status === 429) {
                throw new Error(`Límite de consultas por minuto alcanzado en la capa gratuita (429 RESOURCE_EXHAUSTED). Espera 10 segundos antes de enviar otra pregunta.`);
            }

            // Si es un error 404 de modelo, continuamos al siguiente modelo
            if (res.status === 404) {
                console.warn(`⚠️ Modelo ${modeloActual} no disponible (404), probando siguiente...`);
                break;
            }

            throw new Error(`Error de Gemini API (${status}): ${msg}`);
        }
    }

    throw ultimoError || new Error('No se pudo obtener respuesta de los servidores de Gemini tras varios reintentos.');
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
// 7. EJECUTORES DE CHAT (GEMINI & DEEPSEEK)
// ==========================================
async function ejecutarChatConGemini({ systemPrompt, history, message, permisosIA }) {
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
    const MAX_ITERATIONS = 3;
    let totalTokensAcumulados = 0;
    let modeloActivoEnChat = geminiModel;

    while (iterations < MAX_ITERATIONS) {
        iterations++;
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
        const parts = candidate?.content?.parts || [];

        if (!parts.length) {
            const razonBloqueo = candidate?.finishReason || responseData?.promptFeedback?.blockReason || 'Respuesta vacía del modelo';
            return {
                reply: `No se pudo generar respuesta en este intento (${razonBloqueo}). Intenta reformular tu consulta.`,
                provider: 'gemini',
                model: modeloActivoEnChat,
                iterations_used: iterations,
                usage: { total_tokens: totalTokensAcumulados },
            };
        }

        contents.push({ role: 'model', parts });

        const functionCalls = parts.filter((p) => p.functionCall);
        if (functionCalls.length === 0) {
            const replyText = parts
                .filter((p) => typeof p.text === 'string' && !p.thought)
                .map((p) => p.text)
                .join('\n')
                .trim();

            return {
                reply: replyText || parts.map((p) => p.text || '').join('\n').trim() || 'Consulta completada.',
                provider: 'gemini',
                model: modeloActivoEnChat,
                iterations_used: iterations,
                usage: { total_tokens: totalTokensAcumulados },
            };
        }

        const responseParts = [];
        for (const part of functionCalls) {
            const { name: toolName, args: toolArgs } = part.functionCall;
            console.log(`[MCP Tool Execution - Gemini] -> ${toolName}:`, toolArgs);

            const rawResult = await executeMcpTool(toolName, toolArgs || {}, permisosIA);
            let parsedResult;
            try {
                parsedResult = JSON.parse(rawResult);
            } catch {
                parsedResult = { resultado: rawResult };
            }

            responseParts.push({
                functionResponse: {
                    name: toolName,
                    response: Array.isArray(parsedResult) ? { registros: parsedResult } : parsedResult,
                },
            });
        }

        contents.push({ role: 'user', parts: responseParts });
    }

    return {
        reply: 'Se alcanzó el límite de pasos para esta consulta. Por favor intenta hacer una pregunta más específica.',
        provider: 'gemini',
        model: modeloActivoEnChat,
        iterations_used: iterations,
        usage: { total_tokens: totalTokensAcumulados },
    };
}

async function ejecutarChatConDeepSeek({ systemPrompt, history, message, permisosIA }) {
    if (!deepseekClient) {
        throw new Error('Falta configurar la variable de entorno DEEPSEEK_API_KEY en el servidor.');
    }

    const messages = [{ role: 'system', content: systemPrompt }];
    for (const item of history) {
        if (!item?.content) continue;
        messages.push({
            role: item.role === 'assistant' || item.role === 'model' ? 'assistant' : 'user',
            content: String(item.content),
        });
    }
    messages.push({ role: 'user', content: String(message) });

    let iterations = 0;
    const MAX_ITERATIONS = 4;
    let totalTokensAcumulados = 0;
    let cacheHitsAcumulados = 0;

    while (iterations < MAX_ITERATIONS) {
        iterations++;
        const allowTools = iterations < MAX_ITERATIONS;

        const response = await deepseekClient.chat.completions.create({
            model: deepseekModel,
            messages,
            ...(allowTools ? { tools: openAiTools, tool_choice: 'auto' } : {}),
            temperature: 0.1,
        });

        if (response?.usage?.total_tokens) {
            totalTokensAcumulados += response.usage.total_tokens;
        }
        if (response?.usage?.prompt_cache_hit_tokens) {
            cacheHitsAcumulados += response.usage.prompt_cache_hit_tokens;
        }

        const assistantMessage = response.choices[0].message;
        messages.push(assistantMessage);

        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            return {
                reply: assistantMessage.content || 'Consulta completada.',
                provider: 'deepseek',
                model: deepseekModel,
                iterations_used: iterations,
                usage: {
                    total_tokens: totalTokensAcumulados,
                    prompt_cache_hit_tokens: cacheHitsAcumulados,
                },
            };
        }

        for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
            console.log(`[MCP Tool Execution - DeepSeek] -> ${toolName}:`, toolArgs);

            const toolResult = await executeMcpTool(toolName, toolArgs, permisosIA);
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolResult,
            });
        }
    }

    return {
        reply: 'Se alcanzó el límite de pasos para esta consulta. Por favor intenta hacer una pregunta más específica.',
        provider: 'deepseek',
        model: deepseekModel,
        iterations_used: iterations,
        usage: {
            total_tokens: totalTokensAcumulados,
            prompt_cache_hit_tokens: cacheHitsAcumulados,
        },
    };
}

// ==========================================
// 8. ENDPOINTS DE SALUD Y CHATBOT DEL FRONTEND
// ==========================================
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'Protemec Intelligence - Servidor MCP (Gemini + DeepSeek) + Azure SQL',
        models: { gemini: geminiModel, deepseek: deepseekModel },
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
            providers: {
                gemini: { model: geminiModel, configured: Boolean(apiKeyGemini) },
                deepseek: { model: deepseekModel, configured: Boolean(apiKeyDeepSeek) },
            },
        });
    } catch (err) {
        res.status(500).json({ status: 'error', database: 'disconnected', details: err.message });
    }
});

app.get('/api/tablas', async (req, res) => {
    try {
        const tablasMap = await obtenerEsquemaMapEnMemoria();
        const tablas = tablasMap ? Object.keys(tablasMap) : [];
        res.json({ tablas });
    } catch (err) {
        res.status(500).json({ error: 'No se pudieron obtener las tablas de Azure SQL.', details: err.message });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], provider = 'gemini', userId = null, usuario = null, esMaestro = false } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'El mensaje es obligatorio.' });
        }

        const proveedorElegido = String(provider).toLowerCase() === 'deepseek' ? 'deepseek' : 'gemini';

        // Obtenemos los permisos reales del usuario directamente desde Azure SQL
        const permisosIA = await obtenerPermisosIAUsuario({ userId, usuario, esMaestro });

        if (!permisosIA.accesoTotalTablas && (!permisosIA.tablasPermitidas || permisosIA.tablasPermitidas.length === 0) && !permisosIA.busquedaEnLinea) {
            return res.json({
                reply: '🔒 Tu perfil no tiene tablas autorizadas ni permiso de búsqueda externa en la IA. Solicita al administrador que asigne tus permisos en **Seguridad y Perfiles**.',
                provider: proveedorElegido,
                model: proveedorElegido === 'deepseek' ? deepseekModel : geminiModel,
                iterations_used: 0,
                usage: { total_tokens: 0 },
            });
        }

        // Precargamos el esquema filtrado según las tablas autorizadas del usuario
        const esquemaTexto = await obtenerResumenEsquemaEnMemoria(permisosIA);

        const reglaAlcance = permisosIA.busquedaEnLinea
            ? 'ALCANCE HÍBRIDO: Puedes consultar los datos internos del ERP en Azure SQL y también responder dudas generales, técnicas o de conocimiento externo/en línea cuando el usuario lo solicite.'
            : 'MODO ESTRICTO SOLO DATOS DEL ERP: Responde ÚNICAMENTE con base en los datos reales consultados en Azure SQL mediante herramientas MCP. NO respondas preguntas de conocimiento general, noticias ni información externa que no provenga de la base de datos autorizada.';

        const reglaTablas = permisosIA.accesoTotalTablas
            ? 'Tienes acceso de lectura a todas las tablas del ERP listadas en el esquema.'
            : `ACCESO RESTRINGIDO POR PERFIL: Solo puedes consultar estas tablas autorizadas: ${permisosIA.tablasPermitidas.join(', ')}. Nunca intentes consultar tablas fuera de esta lista.`;

        const systemPrompt = `Eres Protemec Intelligence, el analista de datos e inteligencia artificial integrado en el ERP de PROTEMEC.
Tienes acceso directo en tiempo real a la base de datos Azure SQL mediante la herramienta 'ejecutar_consulta_sql'.

${esquemaTexto ? `ESQUEMA AUTORIZADO DE TABLAS Y COLUMNAS EN AZURE SQL:\n${esquemaTexto}\n` : 'No hay tablas autorizadas en este perfil.\n'}
Reglas de operación:
1. ${reglaTablas}
2. ${reglaAlcance}
3. Usa directamente 'ejecutar_consulta_sql' con los nombres exactos de tablas y columnas del esquema anterior para ahorrar llamadas a la API.
4. Usa sintaxis T-SQL de Microsoft SQL Server (usa TOP N, GETDATE(), DATEADD, ISNULL, etc., NUNCA uses LIMIT).
5. Si un cálculo o cruce de datos se puede hacer en SQL (SUM, COUNT, AVG, GROUP BY), hazlo directamente en la consulta para ahorrar tokens y ser exacto.
6. Analiza los datos obtenidos y entrega respuestas ejecutivas en español, claras, con métricas exactas en pesos mexicanos (MXN) cuando aplique, y bien estructuradas en Markdown (tablas o listas).`;

        const resultado = proveedorElegido === 'deepseek'
            ? await ejecutarChatConDeepSeek({ systemPrompt, history, message, permisosIA })
            : await ejecutarChatConGemini({ systemPrompt, history, message, permisosIA });

        return res.json(resultado);
    } catch (error) {
        console.error('Error en /api/chat:', error.message);
        res.status(500).json({
            error: 'Error procesando la solicitud con el modelo IA y Azure SQL.',
            details: error.message,
        });
    }
});

// En local usa CHAT_PORT (3001) para no chocar con server.js (3000); en Azure App Service usa process.env.PORT
const PORT = process.env.CHAT_PORT || (process.env.WEBSITE_SITE_NAME ? process.env.PORT : 3001) || 3001;
app.listen(PORT, () => {
    console.log(`✅ Servidor ERP + MCP (Gemini: ${geminiModel} | DeepSeek: ${deepseekModel}) activo en http://localhost:${PORT}`);
});
