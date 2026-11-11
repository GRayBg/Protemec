import { useState, useRef, useEffect } from 'react'

// Renderizador ligero de Markdown (Tablas, Negritas, Listas y Bloques de código) sin librerías externas
function formatearTextoEnLinea(texto) {
  if (!texto) return null
  const partes = String(texto).split(/(\*\*.*?\*\*|`.*?`)/g)
  return partes.map((parte, i) => {
    if (parte.startsWith('**') && parte.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 700, color: '#111827' }}>{parte.slice(2, -2)}</strong>
    }
    if (parte.startsWith('`') && parte.endsWith('`')) {
      return (
        <code
          key={i}
          className="pro-mono"
          style={{
            backgroundColor: 'rgba(0,0,0,0.06)',
            padding: '2px 5px',
            borderRadius: '4px',
            fontSize: '12px'
          }}
        >
          {parte.slice(1, -1)}
        </code>
      )
    }
    return parte
  })
}

function RenderizadorMarkdown({ contenido }) {
  if (!contenido) return null
  const lineas = String(contenido).split('\n')
  const elementos = []
  let i = 0

  while (i < lineas.length) {
    const linea = lineas[i]

    // 1. Detectar Tablas Markdown (| Col1 | Col2 |)
    if (linea.trim().startsWith('|') && linea.trim().endsWith('|')) {
      const filasTabla = []
      while (i < lineas.length && lineas[i].trim().startsWith('|') && lineas[i].trim().endsWith('|')) {
        filasTabla.push(lineas[i].trim())
        i++
      }

      if (filasTabla.length >= 2) {
        const cabeceras = filasTabla[0]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim())

        // Ignoramos la fila separadora |---|---|
        const filasDatos = filasTabla
          .slice(1)
          .filter((f) => !/^[|\s-:]+$/.test(f))
          .map((f) =>
            f
              .split('|')
              .slice(1, -1)
              .map((c) => c.trim())
          )

        elementos.push(
          <div key={`tabla-${i}`} style={{ overflowX: 'auto', margin: '10px 0', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', backgroundColor: '#ffffff' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  {cabeceras.map((h, idx) => (
                    <th key={idx} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>
                      {formatearTextoEnLinea(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasDatos.map((fila, rIdx) => (
                  <tr key={rIdx} style={{ borderBottom: rIdx < filasDatos.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    {fila.map((celda, cIdx) => (
                      <td key={cIdx} style={{ padding: '7px 12px', color: '#1f2937' }}>
                        {formatearTextoEnLinea(celda)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        continue
      }
    }

    // 2. Detectar Encabezados (###, ##, #)
    if (/^#{1,3}\s+/.test(linea)) {
      const textoTitulo = linea.replace(/^#{1,3}\s+/, '')
      elementos.push(
        <div key={i} style={{ fontWeight: 700, fontSize: '14px', color: '#111827', marginTop: '10px', marginBottom: '4px' }}>
          {formatearTextoEnLinea(textoTitulo)}
        </div>
      )
      i++
      continue
    }

    // 3. Detectar Listas (- o *)
    if (/^\s*[-*]\s+/.test(linea)) {
      const textoItem = linea.replace(/^\s*[-*]\s+/, '')
      elementos.push(
        <div key={i} style={{ display: 'flex', gap: '6px', marginLeft: '6px', marginBottom: '3px' }}>
          <span style={{ color: '#0071e3', fontWeight: 700 }}>•</span>
          <span style={{ flex: 1 }}>{formatearTextoEnLinea(textoItem)}</span>
        </div>
      )
      i++
      continue
    }

    // 4. Líneas vacías
    if (!linea.trim()) {
      elementos.push(<div key={i} style={{ height: '6px' }} />)
      i++
      continue
    }

    // 5. Párrafo normal
    elementos.push(
      <div key={i} style={{ marginBottom: '4px', lineHeight: 1.5 }}>
        {formatearTextoEnLinea(linea)}
      </div>
    )
    i++
  }

  return <div>{elementos}</div>
}

const AZURE_CHAT_URL = 'https://api-chatbot-e0e5gtfvbdf6aact.westus3-01.azurewebsites.net'
const LOCAL_CHAT_URL = 'http://localhost:3001'

export default function GestionChatbot({
  CHAT_API_URL = AZURE_CHAT_URL,
  API_URL = '',
  compras = [],
  proyectos = [],
  usuarioActual = null,
  mostrarToast = null
}) {
  const [mensajes, setMensajes] = useState([
    {
      remitente: 'bot',
      texto: `¡Hola${usuarioActual?.nombre ? `, **${usuarioActual.nombre}**` : ''}! Soy **Protemec Intelligence** impulsado por **DeepSeek + MCP**.\nTengo conexión directa de lectura a las tablas de **Azure SQL Database** del ERP. ¿Qué datos o métricas deseas analizar hoy?`,
      meta: null
    }
  ])
  const [entrada, setEntrada] = useState('')
  const [pensando, setPensando] = useState(false)
  const [urlServidorChat, setUrlServidorChat] = useState(() =>
    (CHAT_API_URL || AZURE_CHAT_URL).replace(/\/+$/, '')
  )

  const finMensajesRef = useRef(null)

  useEffect(() => {
    finMensajesRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, pensando])

  // Respaldo local en caso de que server2.js no esté encendido aún
  const generarRespuestaRespaldoLocal = (textoConsulta) => {
    const q = textoConsulta.toLowerCase()
    if (q.includes('compra') || q.includes('gasto') || q.includes('total')) {
      const comprados = compras.filter((c) => String(c.Estatus || c.estatus || 'Comprado').toLowerCase() === 'comprado')
      const total = comprados.reduce((acc, c) => acc + Number(c.Costo || c.costo || 0) * 1.16, 0)
      return `⚠️ *(Modo local sin conexión a server2.js)*\nActualmente tienes **${comprados.length} compras firmes** registradas en memoria, con una inversión acumulada de **$${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN** (IVA incluido).`
    }
    if (q.includes('proyecto')) {
      return `⚠️ *(Modo local sin conexión a server2.js)*\nTienes **${proyectos.length} proyectos** registrados en el catálogo corporativo.`
    }
    return `⚠️ No se pudo conectar con **${urlServidorChat}/api/chat**.\nVerifica que tu terminal tenga corriendo \`node server2.js\` en el puerto 3001 y que tu \`GEMINI_API_KEY\` esté configurada en las variables de entorno.`
  }

  const enviarConsulta = async (textoConsulta) => {
    const preguntaLimpia = textoConsulta.trim()
    if (!preguntaLimpia || pensando) return

    // Guardamos el mensaje del usuario en la vista
    const nuevosMensajes = [...mensajes, { remitente: 'usuario', texto: preguntaLimpia }]
    setMensajes(nuevosMensajes)
    setEntrada('')
    setPensando(true)

    // Convertimos los últimos 6 mensajes al formato de historial de OpenAI/DeepSeek
    const historialParaApi = nuevosMensajes
      .slice(1) // Omitimos el saludo inicial
      .slice(-7, -1) // Últimos 6 mensajes previos a la pregunta actual
      .map((m) => ({
        role: m.remitente === 'usuario' ? 'user' : 'assistant',
        content: m.texto
      }))

    try {
      const baseUrlLimpia = String(urlServidorChat || AZURE_CHAT_URL).replace(/\/+$/, '')
      const res = await fetch(`${baseUrlLimpia}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: preguntaLimpia,
          history: historialParaApi
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.details || data.error || 'Error en el servidor MCP')
      }

      setMensajes((prev) => [
        ...prev,
        {
          remitente: 'bot',
          texto: data.reply || 'Consulta completada sin texto de retorno.',
          meta: {
            iteraciones: data.iterations_used || 1,
            tokensTotales: data.usage?.total_tokens || null,
            tokensCache: data.usage?.prompt_cache_hit_tokens || 0
          }
        }
      ])
    } catch (err) {
      console.error('Error conectando con server2.js:', err)
      if (mostrarToast) {
        mostrarToast('No se detectó server2.js activo, usando respaldo local', 'alerta')
      }
      const respuestaFallback = generarRespuestaRespaldoLocal(preguntaLimpia)
      setMensajes((prev) => [
        ...prev,
        {
          remitente: 'bot',
          texto: `${respuestaFallback}\n\nDetalle técnico: \`${err.message}\``,
          esError: true
        }
      ])
    } finally {
      setPensando(false)
    }
  }

  const manejarEnvio = (e) => {
    e.preventDefault()
    enviarConsulta(entrada)
  }

  const limpiarConversacion = () => {
    setMensajes([
      {
        remitente: 'bot',
        texto: 'Conversación reiniciada. ¿Qué consulta deseas ejecutar sobre Azure SQL?',
        meta: null
      }
    ])
  }

  const sugerenciasRapidas = [
    { label: '💳 Top 5 proveedores por gasto', prompt: 'Muéstrame en una tabla el Top 5 de proveedores con mayor gasto acumulado en compras y cuántas órdenes tiene cada uno.' },
    { label: '📁 Costos por proyecto', prompt: ' Haz un desglose en tabla del costo total invertido agrupado por proyecto.' },
    { label: '📦 Movimientos y préstamos de almacén', prompt: '¿Cuáles son los últimos movimientos o préstamos registrados en el almacén?' },
    { label: '👥 Plantilla RH y KPIs', prompt: '¿Cuántos empleados activos tenemos en Recursos Humanos y cuál es el resumen de sus evaluaciones KPI?' },
    { label: '🗄️ Ver tablas de Azure SQL', prompt: '¿Qué tablas existen actualmente en la base de datos del ERP?' }
  ]

  return (
    <div className="pro-card" style={estilos.contenedorChat}>
      {/* CABECERA DEL CHAT */}
      <div style={estilos.cabeceraChat}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={estilos.iconoAi}>✨</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ fontSize: '15px', margin: 0 }}>Protemec Intelligence</h3>
              <span
                className="pro-mono"
                style={{
                  fontSize: '10.5px',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  backgroundColor: '#eef2ff',
                  color: '#4f46e5',
                  fontWeight: 700
                }}
              >
                DeepSeek + Azure SQL MCP
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#86868b', margin: 0 }}>
              Consultas T-SQL en tiempo real con seguridad de solo lectura
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Selector rápido por si pruebas en Azure Cloud o en localhost:3001 */}
          <select
            value={urlServidorChat}
            onChange={(e) => setUrlServidorChat(e.target.value)}
            className="pro-input pro-mono"
            style={{ fontSize: '11.5px', padding: '5px 8px', width: 'auto', height: '30px' }}
            title="Endpoint del servidor MCP"
          >
            <option value={AZURE_CHAT_URL}>Azure Cloud ({AZURE_CHAT_URL})</option>
            <option value={LOCAL_CHAT_URL}>Local MCP ({LOCAL_CHAT_URL})</option>
          </select>

          <button
            type="button"
            onClick={limpiarConversacion}
            className="pro-btn pro-btn-secondary pro-btn-sm"
            title="Limpiar historial de chat"
          >
            🧹 Limpiar
          </button>
        </div>
      </div>

      {/* ÁREA DE MENSAJES */}
      <div style={estilos.cuerpoMensajes}>
        {mensajes.map((m, idx) => {
          const esUsuario = m.remitente === 'usuario'
          return (
            <div
              key={idx}
              style={
                esUsuario
                  ? estilos.burbujaUsuario
                  : m.esError
                    ? { ...estilos.burbujaBot, borderColor: '#fca5a5', backgroundColor: '#fef2f2' }
                    : estilos.burbujaBot
              }
            >
              {esUsuario ? (
                <div>{m.texto}</div>
              ) : (
                <RenderizadorMarkdown contenido={m.texto} />
              )}

              {/* Metadatos de ejecución MCP y Tokens */}
              {!esUsuario && m.meta && (
                <div style={estilos.metaFooter} className="pro-mono">
                  <span>⚡ {m.meta.iteraciones} {m.meta.iteraciones === 1 ? 'paso' : 'pasos MCP (SQL)'}</span>
                  {m.meta.tokensTotales && (
                    <span>• 📊 {m.meta.tokensTotales} tokens</span>
                  )}
                  {m.meta.tokensCache > 0 && (
                    <span style={{ color: '#059669' }}>• 💾 {m.meta.tokensCache} en caché (-90% costo)</span>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {pensando && (
          <div style={estilos.burbujaBot}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#4b5563', fontSize: '13px', fontWeight: 500 }}>
              <div style={estilos.miniSpinner} />
              <span>Consultando tablas en Azure SQL mediante MCP y analizando con DeepSeek...</span>
            </div>
          </div>
        )}

        <div ref={finMensajesRef} />
      </div>

      {/* SUGERENCIAS DE CONSULTA */}
      <div style={estilos.sugerenciasBar}>
        {sugerenciasRapidas.map((sug, i) => (
          <button
            key={i}
            type="button"
            disabled={pensando}
            onClick={() => enviarConsulta(sug.prompt)}
            className="pro-btn pro-btn-secondary pro-btn-sm"
            style={{ fontSize: '11.5px' }}
          >
            {sug.label}
          </button>
        ))}
      </div>

      {/* FORMULARIO DE ENTRADA */}
      <form onSubmit={manejarEnvio} style={estilos.formularioChat}>
        <input
          type="text"
          placeholder="Pregunta sobre compras, proyectos, inventario, préstamos o KPIs de RH..."
          value={entrada}
          disabled={pensando}
          onChange={(e) => setEntrada(e.target.value)}
          className="pro-input"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={pensando || !entrada.trim()}
          className="pro-btn pro-btn-primary"
          style={{ minWidth: '110px', justifyContent: 'center' }}
        >
          {pensando ? 'Analizando...' : 'Enviar ➔'}
        </button>
      </form>
    </div>
  )
}

const estilos = {
  contenedorChat: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 140px)',
    minHeight: '540px',
    overflow: 'hidden'
  },
  cabeceraChat: {
    padding: '14px 22px',
    borderBottom: '1px solid var(--border-light)',
    backgroundColor: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap'
  },
  iconoAi: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #0071e3 0%, #7c3aed 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    flexShrink: 0
  },
  cuerpoMensajes: {
    flex: 1,
    padding: '22px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px'
  },
  burbujaUsuario: {
    alignSelf: 'flex-end',
    backgroundColor: '#0071e3',
    color: '#ffffff',
    padding: '10px 16px',
    borderRadius: '16px 16px 2px 16px',
    maxWidth: '72%',
    fontSize: '13.5px',
    boxShadow: '0 2px 8px rgba(0, 113, 227, 0.2)'
  },
  burbujaBot: {
    alignSelf: 'flex-start',
    backgroundColor: '#f5f5f7',
    color: '#1d1d1f',
    padding: '14px 18px',
    borderRadius: '16px 16px 16px 2px',
    maxWidth: '84%',
    fontSize: '13.5px',
    border: '1px solid var(--border-light)'
  },
  metaFooter: {
    marginTop: '10px',
    paddingTop: '6px',
    borderTop: '1px solid rgba(0,0,0,0.06)',
    fontSize: '10.5px',
    color: '#6b7280',
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  miniSpinner: {
    width: '16px',
    height: '16px',
    border: '2.5px solid rgba(0, 113, 227, 0.2)',
    borderTopColor: '#0071e3',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0
  },
  sugerenciasBar: {
    padding: '8px 22px',
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    borderTop: '1px solid rgba(0,0,0,0.04)',
    backgroundColor: '#fafafa'
  },
  formularioChat: {
    padding: '14px 22px',
    borderTop: '1px solid var(--border-light)',
    display: 'flex',
    gap: '10px',
    backgroundColor: '#ffffff'
  }
}