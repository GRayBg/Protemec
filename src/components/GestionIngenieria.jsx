import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import GlbViewer from './GlbViewer'

export default function GestionIngenieria({
  disenos = [],
  proyectosUnicos = [],
  API_URL,
  recargarDatos,
  subVista = 'explorador',
  setPestanaIngenieria,
  mostrarToast,
  puedeEditar = true
}) {
  const [proyectoFiltro, setProyectoFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')

  // Sub-modo estilo MS Project dentro de Control de Avance ('lista' | 'kanban' | 'calendario')
  const [modoAvance, setModoAvance] = useState('kanban')

  // Estado para Drag & Drop en Kanban
  const [itemArrastrado, setItemArrastrado] = useState(null)
  const [columnaHover, setColumnaHover] = useState(null)

  // Estado para Fechas Compromiso del Calendario MS Project (persistido en localStorage)
  const [fechasCompromiso, setFechasCompromiso] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('protemec_bom_fechas') || '{}')
    } catch {
      return {}
    }
  })
  const [mesActual, setMesActual] = useState(() => {
    const hoy = new Date()
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  })
  const [modalFechaItem, setModalFechaItem] = useState(null)
  const [fechaTemporal, setFechaTemporal] = useState('')

  useEffect(() => {
    localStorage.setItem('protemec_bom_fechas', JSON.stringify(fechasCompromiso))
  }, [fechasCompromiso])

  // Formulario y Modo Edición
  const [elementoEditando, setElementoEditando] = useState(null)
  const [nombre, setNombre] = useState('')
  const [proyectoForm, setProyectoForm] = useState('')
  const [tipoNivel, setTipoNivel] = useState('Ensamble')
  const [padreID, setPadreID] = useState('')
  const [cantidadRequerida, setCantidadRequerida] = useState(1)
  const [archivoGlb, setArchivoGlb] = useState(null)
  const [archivoPdf, setArchivoPdf] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [modeloSeleccionado, setModeloSeleccionado] = useState(null)
  const [pdfPrevisualizando, setPdfPrevisualizando] = useState(null)

  const [filasAbiertas, setFilasAbiertas] = useState({})

  const notificar = (msg, tipo = 'exito') => {
    if (mostrarToast) mostrarToast(msg, tipo)
  }

  const toggleFila = (id) => {
    setFilasAbiertas((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const iniciarEdicion = (item) => {
    if (!puedeEditar) return notificar('Tu perfil no tiene permisos de edición en Ingeniería', 'alerta')
    setElementoEditando(item.ID)
    setNombre(item.Nombre || '')
    setProyectoForm(item.Proyecto || '')
    setTipoNivel(item.TipoNivel || 'Ensamble')
    setPadreID(item.PadreID || '')
    setCantidadRequerida(item.CantidadRequerida || 1)
    setArchivoGlb(null)
    setArchivoPdf(null)
    if (setPestanaIngenieria) setPestanaIngenieria('nuevo')
  }

  const disenosFiltrados = disenos.filter((d) => {
    const coincideProyecto = proyectoFiltro ? d.Proyecto === proyectoFiltro : true
    const coincideTexto = d.Nombre ? d.Nombre.toLowerCase().includes(busqueda.toLowerCase()) : true
    return coincideProyecto && coincideTexto
  })

  const padresDisponibles = disenos.filter(
    (d) =>
      (d.TipoNivel === 'Ensamble' || d.TipoNivel === 'Subensamble') &&
      (!proyectoForm || d.Proyecto === proyectoForm) &&
      d.ID !== elementoEditando
  )

  const manejarEnvio = async (e) => {
    e.preventDefault()
    if (!puedeEditar) return notificar('Sin permisos para modificar BOM', 'error')
    if (!proyectoForm || !nombre) {
      notificar('Selecciona un proyecto e ingresa el nombre del componente', 'alerta')
      return
    }

    setGuardando(true)
    const formData = new FormData()
    formData.append('nombre', nombre)
    formData.append('proyecto', proyectoForm)
    formData.append('tipoNivel', tipoNivel)
    formData.append('padreID', padreID || '')
    formData.append('cantidadRequerida', cantidadRequerida || 1)
    if (archivoGlb) formData.append('archivoGlb', archivoGlb)
    if (archivoPdf) formData.append('archivoPdf', archivoPdf)

    if (elementoEditando) {
      const itemActual = disenos.find((d) => d.ID === elementoEditando)
      if (itemActual?.UrlGLB) formData.append('urlGlbActual', itemActual.UrlGLB)
      if (itemActual?.UrlPDF) formData.append('urlPdfActual', itemActual.UrlPDF)
    }

    try {
      const urlEndpoint = elementoEditando
        ? `${API_URL}/api/ingenieria/${elementoEditando}`
        : `${API_URL}/api/ingenieria`
      const metodo = elementoEditando ? 'PUT' : 'POST'

      const res = await fetch(urlEndpoint, { method: metodo, body: formData })
      if (!res.ok) {
        const errorBody = await res.text()
        throw new Error(errorBody || 'Error al guardar en la base de datos')
      }

      setNombre('')
      setPadreID('')
      setCantidadRequerida(1)
      setArchivoGlb(null)
      setArchivoPdf(null)
      setElementoEditando(null)

      await recargarDatos()
      notificar(elementoEditando ? 'Componente actualizado con éxito' : 'Nuevo componente BOM registrado')
      if (setPestanaIngenieria) setPestanaIngenieria('explorador')
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  const actualizarCantidades = async (id, nuevaLista, nuevaRequerida) => {
    if (!puedeEditar) return notificar('Modo solo lectura: no puedes modificar avances', 'alerta')
    try {
      const res = await fetch(`${API_URL}/api/ingenieria/${id}/avance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidadLista: nuevaLista, cantidadRequerida: nuevaRequerida })
      })
      if (!res.ok) throw new Error('No se pudo actualizar el avance')
      recargarDatos()
      notificar('Avance actualizado en Azure SQL')
    } catch (err) {
      notificar(err.message, 'error')
    }
  }

  const calcularAvanceAcumulado = (nodoId, multiplicadorPadre = 1) => {
    const elemento = disenosFiltrados.find((d) => d.ID === nodoId)
    if (!elemento) return { reqTotal: 0, listaTotal: 0 }

    const reqUnitaria = elemento.CantidadRequerida || 1
    const reqEfectiva = reqUnitaria * multiplicadorPadre
    const hijos = disenosFiltrados.filter((d) => d.PadreID === nodoId)

    if (hijos.length === 0) {
      return { reqTotal: reqEfectiva, listaTotal: elemento.CantidadLista || 0 }
    }

    let totalReqPiezas = 0
    let conjuntosPosibles = Infinity

    hijos.forEach((hijo) => {
      const acum = calcularAvanceAcumulado(hijo.ID, reqEfectiva)
      totalReqPiezas += acum.reqTotal
      const reqPorPadre = hijo.CantidadRequerida || 1
      const conjuntosQueAporta = Math.floor(acum.listaTotal / reqPorPadre)
      if (conjuntosQueAporta < conjuntosPosibles) conjuntosPosibles = conjuntosQueAporta
    })

    if (conjuntosPosibles === Infinity) conjuntosPosibles = 0

    return { reqTotal: reqEfectiva, listaTotal: conjuntosPosibles, piezasEfectivasReq: totalReqPiezas }
  }

  const obtenerMetricasItem = (item) => {
    const tieneHijos = disenosFiltrados.some((h) => h.PadreID === item.ID)
    const reqUnitaria = item.CantidadRequerida || 1
    let listaTotal = item.CantidadLista || 0
    if (tieneHijos) {
      listaTotal = calcularAvanceAcumulado(item.ID, 1).listaTotal
    }
    const porcentaje = reqUnitaria > 0 ? Math.min(100, Math.round((listaTotal / reqUnitaria) * 100)) : 0
    const estadoKanban = porcentaje >= 100 ? 'completado' : porcentaje > 0 ? 'proceso' : 'pendiente'
    return { tieneHijos, reqUnitaria, listaTotal, porcentaje, estadoKanban }
  }

  // MANEJADORES DRAG & DROP KANBAN
  const manejarDropKanban = (columnaDestino) => {
    setColumnaHover(null)
    if (!itemArrastrado || !puedeEditar) return

    const { tieneHijos, reqUnitaria } = obtenerMetricasItem(itemArrastrado)
    if (tieneHijos) {
      notificar('Los ensambles padre calculan su avance automáticamente a partir de sus piezas hijas', 'alerta')
      setItemArrastrado(null)
      return
    }

    let nuevaCantidadLista = 0
    if (columnaDestino === 'pendiente') {
      nuevaCantidadLista = 0
    } else if (columnaDestino === 'proceso') {
      nuevaCantidadLista = Math.max(1, Math.floor(reqUnitaria / 2))
      if (reqUnitaria === 1) {
        notificar('Para piezas de 1 unidad, usa "+1" o arrastra a Completado', 'alerta')
        setItemArrastrado(null)
        return
      }
    } else if (columnaDestino === 'completado') {
      nuevaCantidadLista = reqUnitaria
    }

    actualizarCantidades(itemArrastrado.ID, nuevaCantidadLista, reqUnitaria)
    setItemArrastrado(null)
  }

  const badgeNivel = (nivel) => {
    const config = {
      Ensamble: { bg: '#eff6ff', color: '#1d4ed8', letra: 'ENS' },
      Subensamble: { bg: '#fffbeb', color: '#b45309', letra: 'SUB' },
      Pieza: { bg: '#ecfdf5', color: '#047857', letra: 'PZA' }
    }[nivel] || { bg: '#f1f5f9', color: '#475569', letra: 'ELM' }

    return (
      <span
        className="pro-mono"
        style={{
          fontSize: '10px',
          padding: '2px 6px',
          borderRadius: '5px',
          fontWeight: 700,
          backgroundColor: config.bg,
          color: config.color
        }}
      >
        {config.letra}
      </span>
    )
  }

  const renderizarFilasExplorador = (padreId = null, nivelProfundidad = 0) => {
    const nodos = disenosFiltrados.filter((d) => {
      if (padreId === null) return !d.PadreID || d.TipoNivel === 'Ensamble'
      return d.PadreID === padreId
    })

    return nodos.map((item) => {
      const tieneHijos = disenosFiltrados.some((h) => h.PadreID === item.ID)
      const estaAbierto = !!filasAbiertas[item.ID]
      const esModeloActivo = modeloSeleccionado === item.UrlGLB

      return (
        <React.Fragment key={item.ID}>
          <tr style={{ backgroundColor: esModeloActivo ? 'rgba(0, 113, 227, 0.05)' : 'transparent' }}>
            <td style={{ paddingLeft: `${14 + nivelProfundidad * 20}px` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {tieneHijos ? (
                  <button
                    onClick={() => toggleFila(item.ID)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '10px',
                      color: '#515154',
                      transform: estaAbierto ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.2s ease'
                    }}
                  >
                    ▶
                  </button>
                ) : (
                  <span style={{ width: '12px', textAlign: 'center', color: '#cbd5e1' }}>•</span>
                )}
                {badgeNivel(item.TipoNivel)}
                <span style={{
                  fontWeight: item.TipoNivel === 'Ensamble' ? 700 : 500,
                  fontSize: '13px',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  flex: 1
                }}>
                  {item.Nombre}
                </span>
              </div>
            </td>

            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <div style={{ display: 'inline-flex', gap: '6px' }}>
                {item.UrlGLB && (
                  <button
                    onClick={() => setModeloSeleccionado(item.UrlGLB)}
                    className={`pro-btn pro-btn-sm ${esModeloActivo ? 'pro-btn-primary' : 'pro-btn-secondary'}`}
                  >
                    {esModeloActivo ? '✓ 3D' : '🧊 3D'}
                  </button>
                )}
                {item.UrlPDF && (
                  <button
                    type="button"
                    onClick={() => setPdfPrevisualizando({ url: item.UrlPDF, nombre: item.Nombre })}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                    title="Ver Plano PDF Centrado"
                  >
                    📄 Plano
                  </button>
                )}
                {puedeEditar && (
                  <button
                    onClick={() => iniciarEdicion(item)}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                    title="Modificar componente"
                  >
                    ✏️
                  </button>
                )}
              </div>
            </td>
          </tr>
          {estaAbierto && renderizarFilasExplorador(item.ID, nivelProfundidad + 1)}
        </React.Fragment>
      )
    })
  }

  const renderizarFilasAvance = (padreId = null, nivelProfundidad = 0, multiplicadorAcumulado = 1) => {
    const nodos = disenosFiltrados.filter((d) => {
      if (padreId === null) return !d.PadreID || d.TipoNivel === 'Ensamble'
      return d.PadreID === padreId
    })

    return nodos.map((item) => {
      const tieneHijos = disenosFiltrados.some((h) => h.PadreID === item.ID)
      const estaAbierto = !!filasAbiertas[item.ID]
      const reqUnitaria = item.CantidadRequerida || 1
      const multiplicadorActual = multiplicadorAcumulado * reqUnitaria

      let reqTotal = reqUnitaria * multiplicadorAcumulado
      let listaTotal = item.CantidadLista || 0

      if (tieneHijos) {
        const acumulado = calcularAvanceAcumulado(item.ID, multiplicadorAcumulado)
        listaTotal = acumulado.listaTotal
      }

      const porcentaje = reqTotal > 0 ? Math.min(100, Math.round((listaTotal / reqTotal) * 100)) : 0
      const colorBarra = porcentaje === 100 ? '#10b981' : porcentaje > 0 ? '#0071e3' : '#cbd5e1'
      const fechaAsignada = fechasCompromiso[item.ID] || ''

      return (
        <React.Fragment key={item.ID}>
          <tr>
            <td style={{ paddingLeft: `${14 + nivelProfundidad * 22}px` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {tieneHijos ? (
                  <button
                    onClick={() => toggleFila(item.ID)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px' }}
                  >
                    {estaAbierto ? '▼' : '▶'}
                  </button>
                ) : (
                  <span style={{ width: '12px', color: '#cbd5e1' }}>•</span>
                )}
                {badgeNivel(item.TipoNivel)}
                <strong style={{
                  fontSize: '13px',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  flex: 1
                }}>
                  {item.Nombre}
                </strong>
              </div>
            </td>

            <td style={{ textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setModalFechaItem(item)
                  setFechaTemporal(fechaAsignada)
                }}
                className="pro-btn pro-btn-secondary pro-btn-sm pro-mono"
              >
                📅 {fechaAsignada || 'Asignar fecha'}
              </button>
            </td>

            <td style={{ textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="number"
                  min="1"
                  disabled={!puedeEditar}
                  defaultValue={reqUnitaria}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!isNaN(val) && val > 0 && val !== reqUnitaria) {
                      actualizarCantidades(item.ID, item.CantidadLista || 0, val)
                    }
                  }}
                  className="pro-input pro-mono"
                  style={{ width: '64px', textAlign: 'center', padding: '5px' }}
                />
                {nivelProfundidad > 0 && (
                  <span className="pro-mono" style={{ fontSize: '11px', color: '#86868b' }}>
                    (Tot: {reqTotal})
                  </span>
                )}
              </div>
            </td>

            <td style={{ textAlign: 'center' }}>
              {tieneHijos ? (
                <span className="pro-badge pro-mono" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                  {listaTotal} juegos
                </span>
              ) : (
                <input
                  type="number"
                  min="0"
                  disabled={!puedeEditar}
                  defaultValue={item.CantidadLista || 0}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!isNaN(val) && val >= 0 && val !== (item.CantidadLista || 0)) {
                      actualizarCantidades(item.ID, val, reqUnitaria)
                    }
                  }}
                  className="pro-input pro-mono"
                  style={{ width: '70px', textAlign: 'center', padding: '5px' }}
                />
              )}
            </td>

            <td style={{ width: '200px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ flex: 1, backgroundColor: '#f1f5f9', height: '8px', borderRadius: '99px', overflow: 'hidden' }}>
                  <div style={{ width: `${porcentaje}%`, backgroundColor: colorBarra, height: '100%', transition: 'width 0.4s ease' }} />
                </div>
                <span className="pro-mono" style={{ fontSize: '11.5px', fontWeight: 700, width: '38px', textAlign: 'right' }}>
                  {porcentaje}%
                </span>
              </div>
            </td>

            <td style={{ textAlign: 'center' }}>
              <span
                className="pro-badge"
                style={{
                  backgroundColor: porcentaje === 100 ? '#ecfdf5' : porcentaje > 0 ? '#eff6ff' : '#f1f5f9',
                  color: porcentaje === 100 ? '#065f46' : porcentaje > 0 ? '#1d4ed8' : '#64748b'
                }}
              >
                {porcentaje === 100 ? '✓ Completado' : porcentaje > 0 ? 'En Proceso' : 'Pendiente'}
              </span>
            </td>
          </tr>
          {estaAbierto && renderizarFilasAvance(item.ID, nivelProfundidad + 1, multiplicadorActual)}
        </React.Fragment>
      )
    })
  }

  // CÁLCULO DE CALENDARIO MENSUAL (MS PROJECT VIEW)
  const construirDiasCalendario = () => {
    const year = mesActual.getFullYear()
    const month = mesActual.getMonth()
    const primerDiaSemana = new Date(year, month, 1).getDay()
    const totalDiasMes = new Date(year, month + 1, 0).getDate()

    const celdas = []
    for (let i = 0; i < primerDiaSemana; i++) celdas.push(null)
    for (let d = 1; d <= totalDiasMes; d++) {
      const fechaISO = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      celdas.push({ dia: d, fechaISO })
    }
    return celdas
  }

  const ensamblesRaiz = disenosFiltrados.filter((d) => !d.PadreID || d.TipoNivel === 'Ensamble')
  let totalRequeridoEnsamble = 0
  let totalListoEnsamble = 0

  ensamblesRaiz.forEach((e) => {
    const req = e.CantidadRequerida || 1
    totalRequeridoEnsamble += req
    const acum = calcularAvanceAcumulado(e.ID, 1)
    totalListoEnsamble += acum.listaTotal
  })

  const PorcentajeGeneral =
    totalRequeridoEnsamble > 0 ? Math.round((totalListoEnsamble / totalRequeridoEnsamble) * 100) : 0

  const columnasKanban = [
    { id: 'pendiente', titulo: '🔴 Pendiente de Iniciar', color: '#ef4444', bgBadge: '#fef2f2' },
    { id: 'proceso', titulo: '🟡 En Fabricación / Proceso', color: '#f59e0b', bgBadge: '#fffbeb' },
    { id: 'completado', titulo: '🟢 Terminado / Listo (100%)', color: '#10b981', bgBadge: '#ecfdf5' }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {subVista !== 'nuevo' && (
        <div className="pro-card" style={{ padding: '16px 20px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <label className="pro-label">Filtrar por Proyecto</label>
            <select value={proyectoFiltro} onChange={(e) => setProyectoFiltro(e.target.value)} className="pro-select">
              <option value="">Todos los Proyectos</option>
              {proyectosUnicos.map((p, i) => (
                <option key={i} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: 2, minWidth: '260px' }}>
            <label className="pro-label">Buscar Componente o Pieza en el BOM</label>
            <input
              type="text"
              placeholder="Escribe el nombre del ensamble o número de parte..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pro-input"
            />
          </div>
        </div>
      )}

      {/* PESTAÑA 1: EXPLORADOR BOM + VISOR 3D */}
      {subVista === 'explorador' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(600px, 45%) 1fr', gap: '20px', alignItems: 'start' }}>
          <div className="pro-card" style={{ height: '640px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
              <h3 style={{ fontSize: '15px' }}>📂 Árbol Estructural de Ensamble (BOM)</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="pro-table">
                <thead>
                  <tr>
                    <th>Estructura</th>
                    <th style={{ textAlign: 'right', width: '25%' }}>Inspección</th>
                  </tr>
                </thead>
                <tbody>
                  {disenosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan="2" style={{ textAlign: 'center', padding: '40px', color: '#86868b' }}>
                        No hay elementos registrados para este criterio.
                      </td>
                    </tr>
                  ) : (
                    renderizarFilasExplorador()
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pro-card" style={{ height: '640px', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '15px' }}>🧊 Inspector CAD 3D Interactivo</h3>
              {modeloSeleccionado && (
                <button onClick={() => setModeloSeleccionado(null)} className="pro-btn pro-btn-secondary pro-btn-sm">
                  Cerrar modelo
                </button>
              )}
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              {modeloSeleccionado ? (
                <GlbViewer key={modeloSeleccionado} modelUrl={modeloSeleccionado} />
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#86868b' }}>
                  <div style={{ fontSize: '36px', marginBottom: '10px' }}>🧊</div>
                  <strong style={{ color: '#1d1d1f', fontSize: '15px' }}>Visor CAD Preparado</strong>
                  <p style={{ fontSize: '13px', marginTop: '4px' }}>
                    Selecciona el botón &ldquo;🧊 3D&rdquo; en cualquier pieza del árbol BOM para inspeccionarla.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: CONTROL DE AVANCE MULTIVISTA (MS PROJECT: LISTA / KANBAN / CALENDARIO) */}
      {subVista === 'avance' && (
        <div className="pro-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* CABECERA CON SELECTOR DE VISTAS ESTILO MS PROJECT */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', paddingBottom: '18px', borderBottom: '1px solid var(--border-light)' }}>
            <div>
              <h3 style={{ fontSize: '17px' }}>📊 Centro de Control de Avance (MS Project Suite)</h3>
              <p style={{ color: '#86868b', fontSize: '13px', marginTop: '2px' }}>
                Ensambles Raíz Terminados: <strong>{totalListoEnsamble}</strong> de {totalRequeridoEnsamble} ({PorcentajeGeneral}% Global)
              </p>
            </div>

            {/* CONMUTADOR DE VISTAS: LISTA / KANBAN / CALENDARIO */}
            <div className="pro-segmented">
              <button
                type="button"
                className={`pro-segmented-btn ${modoAvance === 'kanban' ? 'active' : ''}`}
                onClick={() => setModoAvance('kanban')}
              >
                📌 Tablero Kanban
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${modoAvance === 'lista' ? 'active' : ''}`}
                onClick={() => setModoAvance('lista')}
              >
                📋 Lista BOM / Gantt
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${modoAvance === 'calendario' ? 'active' : ''}`}
                onClick={() => setModoAvance('calendario')}
              >
                📅 Calendario MS Project
              </button>
            </div>
          </div>

          {/* MODO 1: TABLERO KANBAN DRAG & DROP */}
          {modoAvance === 'kanban' && (
            <div>
              <div style={{ marginBottom: '12px', fontSize: '12.5px', color: '#515154', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>💡 <strong>Tip interactivo:</strong> Arrastra y suelta cualquier pieza entre las columnas para actualizar su estado en Azure SQL al instante.</span>
              </div>

              <div className="kanban-board">
                {columnasKanban.map((col) => {
                  const itemsColumna = disenosFiltrados.filter(
                    (item) => obtenerMetricasItem(item).estadoKanban === col.id
                  )

                  return (
                    <div
                      key={col.id}
                      className={`kanban-column ${columnaHover === col.id ? 'drag-over' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setColumnaHover(col.id)
                      }}
                      onDragLeave={() => setColumnaHover(null)}
                      onDrop={() => manejarDropKanban(col.id)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                        <strong style={{ fontSize: '13px', color: '#1d1d1f' }}>{col.titulo}</strong>
                        <span className="pro-badge pro-mono" style={{ backgroundColor: col.bgBadge, color: col.color }}>
                          {itemsColumna.length}
                        </span>
                      </div>

                      {itemsColumna.map((item) => {
                        const { tieneHijos, reqUnitaria, listaTotal, porcentaje } = obtenerMetricasItem(item)
                        const fechaItem = fechasCompromiso[item.ID]

                        return (
                          <div
                            key={item.ID}
                            className="kanban-card"
                            draggable={puedeEditar && !tieneHijos}
                            onDragStart={() => setItemArrastrado(item)}
                            onDragEnd={() => {
                              setItemArrastrado(null)
                              setColumnaHover(null)
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                {badgeNivel(item.TipoNivel)}
                                <strong style={{ fontSize: '13.5px', color: '#1d1d1f' }}>{item.Nombre}</strong>
                              </div>
                              <span className="pro-mono" style={{ fontSize: '12px', fontWeight: 700, color: col.color }}>
                                {porcentaje}%
                              </span>
                            </div>

                            <div style={{ fontSize: '11.5px', color: '#86868b', marginBottom: '10px' }}>
                              📁 {item.Proyecto || 'Sin proyecto'}
                            </div>

                            {/* Barra de progreso en la tarjeta */}
                            <div style={{ width: '100%', backgroundColor: '#f1f5f9', height: '6px', borderRadius: '99px', overflow: 'hidden', marginBottom: '10px' }}>
                              <div style={{ width: `${porcentaje}%`, backgroundColor: col.color, height: '100%', transition: 'width 0.3s ease' }} />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <span className="pro-mono" style={{ fontSize: '11.5px', fontWeight: 600, color: '#515154' }}>
                                Piezas: {listaTotal} / {reqUnitaria}
                              </span>

                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModalFechaItem(item)
                                    setFechaTemporal(fechaItem || '')
                                  }}
                                  className="pro-btn pro-btn-secondary pro-btn-sm"
                                  style={{ padding: '3px 7px', fontSize: '11px' }}
                                  title="Programar fecha en calendario"
                                >
                                  📅 {fechaItem ? fechaItem.slice(5) : '+Fecha'}
                                </button>

                                {puedeEditar && !tieneHijos && listaTotal < reqUnitaria && (
                                  <button
                                    type="button"
                                    onClick={() => actualizarCantidades(item.ID, listaTotal + 1, reqUnitaria)}
                                    className="pro-btn pro-btn-primary pro-btn-sm"
                                    style={{ padding: '3px 8px', fontSize: '11px' }}
                                    title="Sumar 1 pieza terminada"
                                  >
                                    +1
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      {itemsColumna.length === 0 && (
                        <div style={{ padding: '36px 12px', textAlign: 'center', color: '#86868b', fontSize: '12px', border: '1px dashed #cbd5e1', borderRadius: '10px' }}>
                          Arrastra piezas aquí
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* MODO 2: LISTA JERÁRQUICA BOM / GANTT */}
          {modoAvance === 'lista' && (
            <div className="pro-table-container">
              <table className="pro-table">
                <thead>
                  <tr>
                    <th>Componente / Estructura</th>
                    <th style={{ textAlign: 'center' }}>Fecha Compromiso</th>
                    <th style={{ textAlign: 'center' }}>Cant. Unitaria</th>
                    <th style={{ textAlign: 'center' }}>Piezas / Juegos Listos</th>
                    <th>Avance Gantt</th>
                    <th style={{ textAlign: 'center' }}>Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  {disenosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: '#86868b' }}>
                        Sin elementos registrados.
                      </td>
                    </tr>
                  ) : (
                    renderizarFilasAvance()
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* MODO 3: CALENDARIO INTERACTIVO MS PROJECT */}
          {modoAvance === 'calendario' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setMesActual(new Date(mesActual.getFullYear(), mesActual.getMonth() - 1, 1))}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                  >
                    ◀ Mes Anterior
                  </button>
                  <h4 style={{ fontSize: '16px', minWidth: '180px', textAlign: 'center', textTransform: 'capitalize' }}>
                    {mesActual.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setMesActual(new Date(mesActual.getFullYear(), mesActual.getMonth() + 1, 1))}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                  >
                    Mes Siguiente ▶
                  </button>
                </div>

                <span style={{ fontSize: '12px', color: '#86868b' }}>
                  Haz clic en cualquier elemento sin fecha abajo o en el Kanban para agendarlo en el calendario.
                </span>
              </div>

              {/* Cuadrícula del Calendario */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
                {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
                  <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: '#86868b', padding: '6px' }}>
                    {d.toUpperCase()}
                  </div>
                ))}

                {construirDiasCalendario().map((celda, idx) => {
                  if (!celda) {
                    return <div key={`empty-${idx}`} style={{ minHeight: '105px', backgroundColor: '#f8fafc', borderRadius: '10px', opacity: 0.4 }} />
                  }

                  const entregablesDia = disenosFiltrados.filter((item) => fechasCompromiso[item.ID] === celda.fechaISO)
                  const esHoy = celda.fechaISO === new Date().toISOString().split('T')[0]

                  return (
                    <div
                      key={celda.fechaISO}
                      style={{
                        minHeight: '105px',
                        backgroundColor: '#ffffff',
                        border: esHoy ? '2px solid #0071e3' : '1px solid var(--border-light)',
                        borderRadius: '10px',
                        padding: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="pro-mono" style={{ fontSize: '12px', fontWeight: 700, color: esHoy ? '#0071e3' : '#515154' }}>
                          {celda.dia}
                        </span>
                        {esHoy && <span style={{ fontSize: '10px', color: '#0071e3', fontWeight: 700 }}>HOY</span>}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', maxHeight: '80px' }}>
                        {entregablesDia.map((ent) => {
                          const { porcentaje } = obtenerMetricasItem(ent)
                          return (
                            <div
                              key={ent.ID}
                              onClick={() => {
                                setModalFechaItem(ent)
                                setFechaTemporal(celda.fechaISO)
                              }}
                              style={{
                                fontSize: '11px',
                                padding: '3px 6px',
                                borderRadius: '5px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                backgroundColor: porcentaje === 100 ? '#ecfdf5' : '#eff6ff',
                                color: porcentaje === 100 ? '#065f46' : '#1d4ed8',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                              title={`${ent.Nombre} (${porcentaje}%)`}
                            >
                              {porcentaje === 100 ? '✓ ' : '⚙️ '}{ent.Nombre}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Piezas pendientes de programar fecha */}
              <div style={{ marginTop: '10px', padding: '14px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                <span className="pro-label">Componentes sin fecha programada (Clic para asignar al calendario)</span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {disenosFiltrados
                    .filter((d) => !fechasCompromiso[d.ID])
                    .map((d) => (
                      <button
                        key={d.ID}
                        type="button"
                        onClick={() => {
                          setModalFechaItem(d)
                          setFechaTemporal(new Date().toISOString().split('T')[0])
                        }}
                        className="pro-btn pro-btn-secondary pro-btn-sm"
                      >
                        ➕ {d.Nombre}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PESTAÑA 3: FORMULARIO DE REGISTRO / EDICIÓN */}
      {subVista === 'nuevo' && (
        <div className="pro-card" style={{ maxWidth: '760px', margin: '0 auto', width: '100%', padding: '28px' }}>
          <h3 style={{ fontSize: '17px', marginBottom: '20px' }}>
            {elementoEditando ? '✏️ Modificar Componente de Ingeniería' : '➕ Dar de Alta Componente en BOM'}
          </h3>

          <form onSubmit={manejarEnvio} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="pro-label">Proyecto Asignado *</label>
              <select
                value={proyectoForm}
                onChange={(e) => {
                  setProyectoForm(e.target.value)
                  setPadreID('')
                }}
                required
                className="pro-select"
              >
                <option value="">-- Seleccionar Proyecto --</option>
                {proyectosUnicos.map((p, i) => (
                  <option key={i} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="pro-label">Nivel Jerárquico *</label>
              <select
                value={tipoNivel}
                onChange={(e) => {
                  setTipoNivel(e.target.value)
                  setPadreID('')
                }}
                className="pro-select"
              >
                <option value="Ensamble">📦 Ensamble General</option>
                <option value="Subensamble">🧩 Sub-ensamble</option>
                <option value="Pieza">⚙️ Pieza Individual</option>
              </select>
            </div>

            {(tipoNivel === 'Subensamble' || tipoNivel === 'Pieza') && (
              <div>
                <label className="pro-label">Ensamble Padre *</label>
                <select value={padreID} onChange={(e) => setPadreID(e.target.value)} required className="pro-select">
                  <option value="">-- Pertenece a --</option>
                  {padresDisponibles.map((e) => (
                    <option key={e.ID} value={e.ID}>
                      [{e.TipoNivel}] {e.Nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="pro-label">Nombre / Número de Parte *</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                placeholder="Ej. Biela de Transmisión..."
                className="pro-input"
              />
            </div>

            <div>
              <label className="pro-label">Cantidad Requerida por Ensamble *</label>
              <input
                type="number"
                min="1"
                value={cantidadRequerida}
                onChange={(e) => setCantidadRequerida(e.target.value)}
                required
                className="pro-input pro-mono"
              />
            </div>

            <div>
              <label className="pro-label">Modelo 3D (.GLB / .GLTF)</label>
              <input
                id="file-glb"
                type="file"
                accept=".glb,.gltf"
                onChange={(e) => setArchivoGlb(e.target.files[0])}
                className="pro-input"
              />
            </div>

            <div>
              <label className="pro-label">Plano Técnico (.PDF)</label>
              <input
                id="file-pdf"
                type="file"
                accept=".pdf"
                onChange={(e) => setArchivoPdf(e.target.files[0])}
                className="pro-input"
              />
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  setElementoEditando(null)
                  setPestanaIngenieria('explorador')
                }}
                className="pro-btn pro-btn-secondary"
              >
                Cancelar
              </button>
              <button type="submit" disabled={guardando} className="pro-btn pro-btn-primary">
                {guardando ? 'Subiendo a Azure Blob...' : elementoEditando ? 'Actualizar Componente' : 'Guardar en BOM'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL PARA ASIGNAR FECHA EN CALENDARIO MS PROJECT (PORTAL AL BODY) */}
      {modalFechaItem &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalFechaItem(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0 }}>📅 Programar Entrega</h3>
                <button onClick={() => setModalFechaItem(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>
              <div className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <span className="pro-label">Componente BOM</span>
                  <strong style={{ fontSize: '14px' }}>{modalFechaItem.Nombre}</strong>
                </div>
                <div>
                  <label className="pro-label">Fecha Compromiso</label>
                  <input
                    type="date"
                    value={fechaTemporal}
                    onChange={(e) => setFechaTemporal(e.target.value)}
                    className="pro-input"
                  />
                </div>
              </div>
              <div className="pro-modal-footer">
                {fechasCompromiso[modalFechaItem.ID] && (
                  <button
                    type="button"
                    onClick={() => {
                      const copia = { ...fechasCompromiso }
                      delete copia[modalFechaItem.ID]
                      setFechasCompromiso(copia)
                      setModalFechaItem(null)
                    }}
                    className="pro-btn pro-btn-danger"
                    style={{ marginRight: 'auto' }}
                  >
                    Quitar fecha
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (fechaTemporal) {
                      setFechasCompromiso((prev) => ({ ...prev, [modalFechaItem.ID]: fechaTemporal }))
                      notificar(`Fecha programada para ${modalFechaItem.Nombre}`)
                    }
                    setModalFechaItem(null)
                  }}
                  className="pro-btn pro-btn-primary"
                >
                  Guardar en Calendario
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* VISOR PDF CENTRADO PARA PLANOS DE INGENIERÍA */}
      {pdfPrevisualizando &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setPdfPrevisualizando(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '940px', height: '86vh' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0 }}>📐 Plano Técnico: {pdfPrevisualizando.nombre}</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a href={pdfPrevisualizando.url} target="_blank" rel="noreferrer" className="pro-btn pro-btn-primary pro-btn-sm">
                    ↗ Abrir en pestaña nueva
                  </a>
                  <button onClick={() => setPdfPrevisualizando(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
                </div>
              </div>
              <div className="pro-modal-body" style={{ flex: 1, padding: 0 }}>
                <iframe src={pdfPrevisualizando.url} title="Plano PDF" style={{ width: '100%', height: '100%', border: 'none' }} />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}