import React, { useState, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

const ETAPAS_PROCESO = [
  { key: 'materialListo', label: 'Material listo', corto: 'Material', icono: '🧱' },
  { key: 'maquinado', label: 'Maquinado', corto: 'Maquinado', icono: '⚙️' },
  { key: 'pintado', label: 'Pintado', corto: 'Pintado', icono: '🎨' }
]

function parsearEtapas(raw, itemId) {
  const base = { materialListo: false, maquinado: false, pintado: false }
  if (raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed && typeof parsed === 'object') {
        return {
          materialListo: Boolean(parsed.materialListo),
          maquinado: Boolean(parsed.maquinado),
          pintado: Boolean(parsed.pintado)
        }
      }
    } catch {
      // Fallback
    }
  }
  try {
    const local = localStorage.getItem(`protemec_etapas_${itemId}`)
    if (local) {
      const parsed = JSON.parse(local)
      return {
        materialListo: Boolean(parsed.materialListo),
        maquinado: Boolean(parsed.maquinado),
        pintado: Boolean(parsed.pintado)
      }
    }
  } catch {
    // Ignore
  }
  return base
}

function leerFechasLocalesLegacy() {
  try {
    return JSON.parse(localStorage.getItem('protemec_bom_fechas') || '{}')
  } catch {
    return {}
  }
}

export default function GestionProduccion({
  disenos = [],
  proyectosUnicos = [],
  API_URL,
  recargarDatos,
  mostrarToast,
  puedeEditar = true
}) {
  const [modoVista, setModoVista] = useState('gantt') // 'gantt' | 'kanban' | 'calendario'
  const [barraSuperiorVisible, setBarraSuperiorVisible] = useState(false)
  const [proyectoFiltro, setProyectoFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtroNivelKanban, setFiltroNivelKanban] = useState('TODOS') // 'TODOS' | 'Pieza' | 'Ensamble' | 'Subensamble'

  // Estado interactivo
  const [filasAbiertas, setFilasAbiertas] = useState({})
  const [itemArrastrado, setItemArrastrado] = useState(null)
  const [columnaHover, setColumnaHover] = useState(null)
  const [subiendoPdfId, setSubiendoPdfId] = useState(null)
  const [guardandoId, setGuardandoId] = useState(null)
  const [pdfPrevisualizando, setPdfPrevisualizando] = useState(null)

  // Calendario MS Project
  const [mesActual, setMesActual] = useState(() => {
    const hoy = new Date()
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  })
  const [modalFechaItem, setModalFechaItem] = useState(null)
  const [fechaTemporal, setFechaTemporal] = useState('')
  const [fechasLegacy] = useState(() => leerFechasLocalesLegacy())

  // Input oculto para subir/reemplazar PDF desde cualquier tarjeta o fila
  const pdfInputRef = useRef(null)
  const itemParaPdfRef = useRef(null)
  const imgInputRef = useRef(null)
  const itemParaImgRef = useRef(null)
  const [menuAdjuntoItem, setMenuAdjuntoItem] = useState(null)
  const [imagenHover, setImagenHover] = useState(null)

  // CRUD: Crear / Editar / Eliminar elemento
  const [modalElementoAbierto, setModalElementoAbierto] = useState(false)
  const [elementoEditando, setElementoEditando] = useState(null)
  const [nombreForm, setNombreForm] = useState('')
  const [proyectoForm, setProyectoForm] = useState('')
  const [tipoNivelForm, setTipoNivelForm] = useState('Pieza')
  const [padreIDForm, setPadreIDForm] = useState('')
  const [cantidadReqForm, setCantidadReqForm] = useState(1)
  const [cantidadListaForm, setCantidadListaForm] = useState(0)
  const [elementoEliminar, setElementoEliminar] = useState(null)
  const [guardandoCrud, setGuardandoCrud] = useState(false)

  const notificar = useCallback(
    (msg, tipo = 'exito') => {
      if (mostrarToast) mostrarToast(msg, tipo)
    },
    [mostrarToast]
  )

  const toggleFila = (id) => {
    setFilasAbiertas((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Mapa rápido por ID para recorrer ancestros sin depender del filtro activo
  const mapaDisenos = useMemo(() => {
    const mapa = new Map()
    disenos.forEach((d) => mapa.set(d.ID, d))
    return mapa
  }, [disenos])

  // Multiplicador acumulado de todos los ensambles padre (ej. 2 ensambles x 2 piezas = 4 global)
  const obtenerInfoAncestros = useCallback(
    (item) => {
      let multiplicadorPadre = 1
      let padreDirecto = null
      const visitados = new Set([item.ID])
      let cursorPadreId = item.PadreID

      while (cursorPadreId && !visitados.has(cursorPadreId)) {
        visitados.add(cursorPadreId)
        const padre = mapaDisenos.get(cursorPadreId)
        if (!padre) break
        if (!padreDirecto) padreDirecto = padre
        multiplicadorPadre *= Math.max(1, Number(padre.CantidadRequerida) || 1)
        cursorPadreId = padre.PadreID
      }

      return { multiplicadorPadre, padreDirecto }
    },
    [mapaDisenos]
  )

  // Fecha efectiva: prioridad columna Azure SQL (FechaCompromiso), respaldo localStorage
  const obtenerFechaItem = useCallback(
    (item) => {
      if (item?.FechaCompromiso) {
        return String(item.FechaCompromiso).split('T')[0]
      }
      return fechasLegacy[item?.ID] || ''
    },
    [fechasLegacy]
  )

  // Cálculo recursivo de juegos listos para ensambles/subensambles
  const calcularAvanceNodo = useCallback(
    function resolverNodo(nodoId, multiplicadorExterno = null, visitados = new Set()) {
      if (visitados.has(nodoId)) {
        return { reqUnitaria: 1, multiplicadorPadre: 1, reqTotal: 1, listaTotal: 0, tieneHijos: false, todasEtapasHijosListas: true }
      }
      const nuevosVisitados = new Set(visitados)
      nuevosVisitados.add(nodoId)

      const elemento = mapaDisenos.get(nodoId)
      if (!elemento) {
        return { reqUnitaria: 1, multiplicadorPadre: 1, reqTotal: 1, listaTotal: 0, tieneHijos: false, todasEtapasHijosListas: true }
      }

      const reqUnitaria = Math.max(1, Number(elemento.CantidadRequerida) || 1)
      const multiplicadorPadre =
        multiplicadorExterno !== null ? multiplicadorExterno : obtenerInfoAncestros(elemento).multiplicadorPadre
      const reqTotal = reqUnitaria * multiplicadorPadre
      const hijos = disenos.filter((d) => d.PadreID === nodoId && !nuevosVisitados.has(d.ID))

      if (hijos.length === 0) {
        const etapas = parsearEtapas(elemento.SeguimientoEtapasJSON, elemento.ID)
        const todasListas = etapas.materialListo && etapas.maquinado && etapas.pintado
        return {
          reqUnitaria,
          multiplicadorPadre,
          reqTotal,
          listaTotal: Math.max(0, Number(elemento.CantidadLista) || 0),
          tieneHijos: false,
          todasEtapasHijosListas: todasListas
        }
      }

      let conjuntosPosibles = Infinity
      let todasEtapasHijosListas = true

      hijos.forEach((hijo) => {
        const acumHijo = resolverNodo(hijo.ID, reqTotal, nuevosVisitados)
        const reqPorPadre = Math.max(1, Number(hijo.CantidadRequerida) || 1)
        const conjuntosQueAporta = Math.floor(acumHijo.listaTotal / reqPorPadre)
        if (conjuntosQueAporta < conjuntosPosibles) conjuntosPosibles = conjuntosQueAporta
        if (!acumHijo.todasEtapasHijosListas || acumHijo.listaTotal < acumHijo.reqTotal) {
          todasEtapasHijosListas = false
        }
      })

      if (conjuntosPosibles === Infinity) conjuntosPosibles = 0

      return {
        reqUnitaria,
        multiplicadorPadre,
        reqTotal,
        listaTotal: conjuntosPosibles,
        tieneHijos: true,
        todasEtapasHijosListas
      }
    },
    [disenos, mapaDisenos, obtenerInfoAncestros]
  )

  // Métricas completas para cualquier pieza o ensamble (usadas en Kanban, Gantt y Calendario)
  const obtenerMetricasItem = useCallback(
    (item) => {
      const { padreDirecto } = obtenerInfoAncestros(item)
      const calc = calcularAvanceNodo(item.ID)
      const etapas = parsearEtapas(item.SeguimientoEtapasJSON, item.ID)
      const etapasCompletas = ETAPAS_PROCESO.filter((e) => etapas[e.key]).length
      const etapasFaltantes = ETAPAS_PROCESO.filter((e) => !etapas[e.key]).map((e) => e.corto)
      const todasEtapasListas = etapasCompletas === ETAPAS_PROCESO.length

      let porcentaje = 0
      let estadoKanban = 'pendiente'

      if (calc.tieneHijos) {
        const pctBase = calc.reqTotal > 0 ? Math.round((calc.listaTotal / calc.reqTotal) * 100) : 0
        if (calc.listaTotal >= calc.reqTotal && calc.todasEtapasHijosListas) {
          porcentaje = 100
          estadoKanban = 'completado'
        } else if (calc.listaTotal > 0 || disenos.some((h) => h.PadreID === item.ID && (Number(h.CantidadLista) > 0 || Object.values(parsearEtapas(h.SeguimientoEtapasJSON, h.ID)).some(Boolean)))) {
          porcentaje = Math.min(99, Math.max(1, pctBase))
          estadoKanban = 'proceso'
        }
      } else {
        const cantidadCompleta = calc.listaTotal >= calc.reqTotal
        if (cantidadCompleta && todasEtapasListas) {
          porcentaje = 100
          estadoKanban = 'completado'
        } else if (calc.listaTotal === 0 && etapasCompletas === 0) {
          porcentaje = 0
          estadoKanban = 'pendiente'
        } else {
          const pctPiezas = calc.reqTotal > 0 ? Math.min(1, calc.listaTotal / calc.reqTotal) * 70 : 0
          const pctEtapas = (etapasCompletas / ETAPAS_PROCESO.length) * 30
          porcentaje = Math.min(99, Math.max(1, Math.round(pctPiezas + pctEtapas)))
          estadoKanban = 'proceso'
        }
      }

      return {
        ...calc,
        padreDirecto,
        etapas,
        etapasCompletas,
        etapasFaltantes,
        todasEtapasListas,
        porcentaje,
        estadoKanban
      }
    },
    [calcularAvanceNodo, disenos, obtenerInfoAncestros]
  )

  const disenosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return disenos.filter((d) => {
      const coincideProyecto = proyectoFiltro ? d.Proyecto === proyectoFiltro : true
      const coincideTexto = q
        ? String(d.Nombre || '').toLowerCase().includes(q) ||
          String(d.Proyecto || '').toLowerCase().includes(q)
        : true
      return coincideProyecto && coincideTexto
    })
  }, [disenos, proyectoFiltro, busqueda])

  const itemsKanban = useMemo(() => {
    if (filtroNivelKanban === 'TODOS') return disenosFiltrados
    return disenosFiltrados.filter((d) => d.TipoNivel === filtroNivelKanban)
  }, [disenosFiltrados, filtroNivelKanban])

  // Resumen ejecutivo del encabezado
  const resumenGlobal = useMemo(() => {
    let pendientes = 0
    let enProceso = 0
    let completados = 0
    let sumaPct = 0

    disenosFiltrados.forEach((d) => {
      const m = obtenerMetricasItem(d)
      sumaPct += m.porcentaje
      if (m.estadoKanban === 'completado') completados++
      else if (m.estadoKanban === 'proceso') enProceso++
      else pendientes++
    })

    const pctPromedio = disenosFiltrados.length > 0 ? Math.round(sumaPct / disenosFiltrados.length) : 0
    return { pendientes, enProceso, completados, pctPromedio, total: disenosFiltrados.length }
  }, [disenosFiltrados, obtenerMetricasItem])

  // =====================================================================
  // PERSISTENCIA EN AZURE SQL (ETAPAS, CANTIDADES, FECHAS Y PDFS)
  // =====================================================================
  const actualizarSeguimiento = async (item, cambios, mensajeExito = 'Seguimiento actualizado') => {
    if (!puedeEditar) return notificar('Modo solo lectura: no tienes permisos de edición', 'alerta')

    try {
      setGuardandoId(item.ID)
      if (cambios.seguimientoEtapas) {
        try {
          localStorage.setItem(`protemec_etapas_${item.ID}`, JSON.stringify(cambios.seguimientoEtapas))
        } catch {
          // Ignore
        }
      }

      const res = await fetch(`${API_URL}/api/ingenieria/${item.ID}/seguimiento`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambios)
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'No se pudo guardar el seguimiento en Azure SQL')
      }

      if (recargarDatos) await recargarDatos()
      if (mensajeExito) notificar(mensajeExito)
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardandoId(null)
    }
  }

  const toggleEtapaPieza = async (item, etapaKey) => {
    if (!puedeEditar) return notificar('Modo solo lectura: no puedes modificar etapas', 'alerta')
    const metricas = obtenerMetricasItem(item)
    const nuevasEtapas = {
      ...metricas.etapas,
      [etapaKey]: !metricas.etapas[etapaKey]
    }
    const todasListas = ETAPAS_PROCESO.every((e) => nuevasEtapas[e.key])
    const estatusAvance =
      metricas.listaTotal >= metricas.reqTotal && todasListas
        ? 'Completado'
        : metricas.listaTotal > 0 || Object.values(nuevasEtapas).some(Boolean)
          ? 'En Proceso'
          : 'Pendiente'

    const etiquetaEtapa = ETAPAS_PROCESO.find((e) => e.key === etapaKey)?.label || etapaKey
    await actualizarSeguimiento(
      item,
      { seguimientoEtapas: nuevasEtapas, estatusAvance },
      `${etiquetaEtapa}: ${nuevasEtapas[etapaKey] ? 'Completado ✓' : 'Pendiente'}`
    )
  }

  const actualizarCantidadLista = async (item, nuevaLista) => {
    if (!puedeEditar) return notificar('Modo solo lectura: no puedes modificar avances', 'alerta')
    const metricas = obtenerMetricasItem(item)
    const valorFinal = Math.max(0, Number(nuevaLista) || 0)
    const estatusAvance =
      valorFinal >= metricas.reqTotal && metricas.todasEtapasListas
        ? 'Completado'
        : valorFinal > 0 || metricas.etapasCompletas > 0
          ? 'En Proceso'
          : 'Pendiente'

    await actualizarSeguimiento(
      item,
      { cantidadLista: valorFinal, estatusAvance },
      valorFinal >= metricas.reqTotal && !metricas.todasEtapasListas
        ? `Piezas completas (${valorFinal}/${metricas.reqTotal}). Falta marcar: ${metricas.etapasFaltantes.join(', ')}`
        : `Avance actualizado: ${valorFinal} / ${metricas.reqTotal} piezas`
    )
  }

  const dispararSubidaPdf = (item) => {
    if (!puedeEditar) return notificar('Modo solo lectura: no puedes subir archivos', 'alerta')
    setMenuAdjuntoItem(item)
  }

  const seleccionarArchivoPdfDirecto = (item) => {
    setMenuAdjuntoItem(null)
    itemParaPdfRef.current = item
    if (pdfInputRef.current) {
      pdfInputRef.current.value = ''
      pdfInputRef.current.click()
    }
  }

  const seleccionarImagenDirecto = (item) => {
    setMenuAdjuntoItem(null)
    itemParaImgRef.current = item
    if (imgInputRef.current) {
      imgInputRef.current.value = ''
      imgInputRef.current.click()
    }
  }

  const manejarArchivoImagenSeleccionado = async (e) => {
    const file = e.target.files?.[0]
    const item = itemParaImgRef.current
    if (!file || !item) return

    try {
      setSubiendoPdfId(item.ID)
      const formData = new FormData()
      formData.append('archivoImagen', file)

      const res = await fetch(`${API_URL}/api/ingenieria/${item.ID}/imagen`, {
        method: 'POST',
        body: formData
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Error al subir la imagen')

      if (recargarDatos) await recargarDatos()
      notificar(`🖼️ Imagen guardada en "${item.Nombre}"`)
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setSubiendoPdfId(null)
      itemParaImgRef.current = null
    }
  }

  const manejarArchivoPdfSeleccionado = async (e) => {
    const file = e.target.files?.[0]
    const item = itemParaPdfRef.current
    if (!file || !item) return

    try {
      setSubiendoPdfId(item.ID)
      const formData = new FormData()
      formData.append('archivoPdf', file)

      const res = await fetch(`${API_URL}/api/ingenieria/${item.ID}/pdf`, {
        method: 'POST',
        body: formData
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Error al subir el plano PDF')

      if (recargarDatos) await recargarDatos()
      notificar(`📄 Plano PDF guardado en "${item.Nombre}"`)
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setSubiendoPdfId(null)
      itemParaPdfRef.current = null
    }
  }

  const guardarFechaCompromiso = async (item, nuevaFecha) => {
    try {
      const locales = leerFechasLocalesLegacy()
      if (nuevaFecha) locales[item.ID] = nuevaFecha
      else delete locales[item.ID]
      localStorage.setItem('protemec_bom_fechas', JSON.stringify(locales))
    } catch {
      // Ignore
    }

    await actualizarSeguimiento(
      item,
      { fechaCompromiso: nuevaFecha || null },
      nuevaFecha ? `Fecha programada (${nuevaFecha}) para "${item.Nombre}"` : `Fecha eliminada de "${item.Nombre}"`
    )
    setModalFechaItem(null)
  }

  const abrirNuevoElemento = () => {
    if (!puedeEditar) return notificar('Modo solo lectura: no puedes agregar elementos', 'alerta')
    setElementoEditando(null)
    setNombreForm('')
    setProyectoForm(proyectoFiltro || proyectosUnicos[0] || '')
    setTipoNivelForm('Pieza')
    setPadreIDForm('')
    setCantidadReqForm(1)
    setCantidadListaForm(0)
    setModalElementoAbierto(true)
  }

  const abrirEditarElemento = (item) => {
    if (!puedeEditar) return notificar('Modo solo lectura: no puedes modificar elementos', 'alerta')
    setElementoEditando(item)
    setNombreForm(item.Nombre || '')
    setProyectoForm(item.Proyecto || '')
    setTipoNivelForm(item.TipoNivel || 'Pieza')
    setPadreIDForm(item.PadreID ? String(item.PadreID) : '')
    setCantidadReqForm(Math.max(1, Number(item.CantidadRequerida) || 1))
    setCantidadListaForm(Math.max(0, Number(item.CantidadLista) || 0))
    setModalElementoAbierto(true)
  }

  const guardarElementoCrud = async (e) => {
    e.preventDefault()
    if (!puedeEditar) return
    if (!nombreForm.trim() || !proyectoForm.trim()) {
      return notificar('Nombre y proyecto son obligatorios', 'alerta')
    }
    try {
      setGuardandoCrud(true)
      const formData = new FormData()
      formData.append('nombre', nombreForm.trim())
      formData.append('proyecto', proyectoForm.trim())
      formData.append('tipoNivel', tipoNivelForm)
      formData.append('padreID', padreIDForm || '')
      formData.append('cantidadRequerida', String(Math.max(1, parseInt(cantidadReqForm, 10) || 1)))
      formData.append('cantidadLista', String(Math.max(0, parseInt(cantidadListaForm, 10) || 0)))

      const url = elementoEditando ? `${API_URL}/api/ingenieria/${elementoEditando.ID}` : `${API_URL}/api/ingenieria`
      const method = elementoEditando ? 'PUT' : 'POST'
      const res = await fetch(url, { method, body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar el elemento')

      setModalElementoAbierto(false)
      if (recargarDatos) await recargarDatos()
      notificar(elementoEditando ? `✏️ "${nombreForm.trim()}" actualizado` : `✅ "${nombreForm.trim()}" agregado`)
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardandoCrud(false)
    }
  }

  const confirmarEliminarElemento = async () => {
    if (!elementoEliminar || !puedeEditar) return
    try {
      setGuardandoCrud(true)
      const res = await fetch(`${API_URL}/api/ingenieria/${elementoEliminar.ID}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar el elemento')

      const nombreElim = elementoEliminar.Nombre
      setElementoEliminar(null)
      if (recargarDatos) await recargarDatos()
      notificar(`🗑️ "${nombreElim}" eliminado`)
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardandoCrud(false)
    }
  }

  // Drag & Drop Kanban respetando el checklist de las 3 etapas antes del 100%
  const manejarDropKanban = async (columnaDestino) => {
    setColumnaHover(null)
    if (!itemArrastrado || !puedeEditar) return

    const item = itemArrastrado
    setItemArrastrado(null)
    const m = obtenerMetricasItem(item)

    if (m.tieneHijos) {
      notificar('Los ensambles padre calculan su avance automáticamente desde sus piezas hijas', 'alerta')
      return
    }

    if (columnaDestino === 'pendiente') {
      await actualizarSeguimiento(
        item,
        {
          cantidadLista: 0,
          seguimientoEtapas: { materialListo: false, maquinado: false, pintado: false },
          estatusAvance: 'Pendiente'
        },
        `"${item.Nombre}" movido a Pendiente`
      )
      return
    }

    if (columnaDestino === 'proceso') {
      const cantObjetivo = m.listaTotal > 0 ? m.listaTotal : Math.max(1, Math.floor(m.reqTotal / 2))
      const etapasObjetivo =
        m.etapasCompletas === 0 ? { ...m.etapas, materialListo: true } : m.etapas
      await actualizarSeguimiento(
        item,
        { cantidadLista: cantObjetivo, seguimientoEtapas: etapasObjetivo, estatusAvance: 'En Proceso' },
        `"${item.Nombre}" en proceso (${cantObjetivo}/${m.reqTotal})`
      )
      return
    }

    if (columnaDestino === 'completado') {
      if (!m.todasEtapasListas) {
        notificar(
          `⚠️ Antes de completar "${item.Nombre}" al 100%, marca: ${m.etapasFaltantes.join(', ')}`,
          'alerta'
        )
        return
      }
      await actualizarSeguimiento(
        item,
        { cantidadLista: m.reqTotal, estatusAvance: 'Completado' },
        `✅ "${item.Nombre}" completado al 100% (${m.reqTotal}/${m.reqTotal})`
      )
    }
  }

  const obtenerUrlPdfSegura = (urlRaw) => {
    if (!urlRaw) return ''
    const limpia = String(urlRaw).trim()
    if (limpia.includes('/api/blob-proxy')) return limpia
    return `${API_URL}/api/blob-proxy?url=${encodeURIComponent(limpia)}`
  }

  const badgeNivel = (nivel) => {
    const config = {
      Ensamble: { bg: '#eff6ff', color: '#1d4ed8', letra: 'ENS' },
      Subensamble: { bg: '#fffbeb', color: '#b45309', letra: 'SUB' },
      Pieza: { bg: '#ecfdf5', color: '#047857', letra: 'PZA' },
      Tarea: { bg: '#f3e8ff', color: '#7e22ce', letra: 'TAR' }
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

  // Renderizado de chips de las 3 etapas (compartido entre Kanban y Gantt)
  const renderizarChecklistEtapas = (item, metricas, compacto = false) => {
    if (metricas.tieneHijos) {
      return (
        <span style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
          Calculado desde piezas hijas
        </span>
      )
    }

    return (
      <div style={{ display: 'flex', gap: compacto ? '4px' : '6px', flexWrap: 'wrap' }}>
        {ETAPAS_PROCESO.map((etapa) => {
          const activa = metricas.etapas[etapa.key]
          return (
            <button
              key={etapa.key}
              type="button"
              disabled={!puedeEditar || guardandoId === item.ID}
              onClick={() => toggleEtapaPieza(item, etapa.key)}
              title={`${etapa.label}: ${activa ? 'Hecho (clic para desmarcar)' : 'Pendiente (clic para marcar)'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: compacto ? '3px 7px' : '4px 8px',
                borderRadius: '999px',
                fontSize: compacto ? '10.5px' : '11px',
                fontWeight: 600,
                cursor: puedeEditar ? 'pointer' : 'default',
                border: `1px solid ${activa ? '#10b981' : '#cbd5e1'}`,
                backgroundColor: activa ? '#ecfdf5' : '#f8fafc',
                color: activa ? '#065f46' : '#64748b',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{activa ? '✓' : '○'}</span>
              <span>{compacto ? etapa.corto : etapa.label}</span>
            </button>
          )
        })}
      </div>
    )
  }

  // Renderizado de botones PDF (compartido entre Kanban y Gantt)
  const renderizarControlesPdf = (item, compacto = false) => {
    const subiendo = subiendoPdfId === item.ID
    return (
      <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
        {item.UrlPDF ? (
          <>
            <button
              type="button"
              onClick={() =>
                setPdfPrevisualizando({
                  url: obtenerUrlPdfSegura(item.UrlPDF),
                  urlDirecta: item.UrlPDF,
                  nombre: item.Nombre
                })
              }
              className="pro-btn pro-btn-secondary pro-btn-sm"
              style={{ padding: compacto ? '3px 7px' : '4px 9px', fontSize: '11px' }}
              title="Abrir plano técnico PDF"
            >
              📄 Plano
            </button>
            {puedeEditar && (
              <button
                type="button"
                disabled={subiendo}
                onClick={() => dispararSubidaPdf(item)}
                className="pro-btn pro-btn-secondary pro-btn-sm"
                style={{ padding: '3px 6px', fontSize: '11px' }}
                title="Reemplazar plano PDF"
              >
                {subiendo ? '⏳' : '📎'}
              </button>
            )}
          </>
        ) : (
          puedeEditar && (
            <button
              type="button"
              disabled={subiendo}
              onClick={() => dispararSubidaPdf(item)}
              className="pro-btn pro-btn-secondary pro-btn-sm"
              style={{ padding: compacto ? '3px 7px' : '4px 9px', fontSize: '11px', color: '#0071e3' }}
              title="Adjuntar plano de dibujo (.PDF)"
            >
              {subiendo ? '⏳ Subiendo...' : '📎 +PDF'}
            </button>
          )
        )}
      </div>
    )
  }

  // Renderizado jerárquico Lista BOM / Gantt con cálculo global
  const renderizarFilasGantt = (padreId = null, nivelProfundidad = 0, visitados = new Set()) => {
    const nodos = disenosFiltrados.filter((d) => {
      if (visitados.has(d.ID)) return false
      if (padreId === null) return !d.PadreID || !disenosFiltrados.some((p) => p.ID === d.PadreID)
      return d.PadreID === padreId
    })

    return nodos.map((item) => {
      const nuevosVisitados = new Set(visitados)
      nuevosVisitados.add(item.ID)
      const tieneHijosVisibles = disenosFiltrados.some((h) => h.PadreID === item.ID && !nuevosVisitados.has(h.ID))
      const estaAbierto = filasAbiertas[item.ID] !== false // Abierto por defecto en Gantt para ver piezas globales
      const m = obtenerMetricasItem(item)
      const colorBarra = m.porcentaje === 100 ? '#10b981' : m.porcentaje > 0 ? '#0071e3' : '#cbd5e1'
      const fechaAsignada = obtenerFechaItem(item)

      return (
        <React.Fragment key={item.ID}>
          <tr>
            <td style={{ paddingLeft: `${8 + nivelProfundidad * 14}px`, paddingRight: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {tieneHijosVisibles ? (
                  <button
                    type="button"
                    onClick={() => toggleFila(item.ID)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', color: '#515154', padding: 0 }}
                  >
                    {estaAbierto ? '▼' : '▶'}
                  </button>
                ) : (
                  <span style={{ width: '10px', color: '#cbd5e1', flexShrink: 0 }}>•</span>
                )}
                {badgeNivel(item.TipoNivel)}
                {item.UrlImagen && (
                  <img
                    src={obtenerUrlPdfSegura(item.UrlImagen)}
                    alt={item.Nombre}
                    onMouseEnter={(e) =>
                      setImagenHover({
                        url: obtenerUrlPdfSegura(item.UrlImagen),
                        nombre: item.Nombre,
                        x: e.clientX,
                        y: e.clientY
                      })
                    }
                    onMouseLeave={() => setImagenHover(null)}
                    style={{
                      width: '28px',
                      height: '28px',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      cursor: 'zoom-in',
                      flexShrink: 0
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: '12.5px', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.25, display: 'block' }}>
                    {item.Nombre}
                  </strong>
                  {!proyectoFiltro && item.Proyecto && (
                    <div style={{ fontSize: '10.5px', color: '#86868b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      📁 {item.Proyecto}
                    </div>
                  )}
                </div>
              </div>
            </td>

            <td style={{ textAlign: 'center', padding: '8px 4px' }}>{renderizarControlesPdf(item, true)}</td>

            <td style={{ padding: '8px 6px' }}>{renderizarChecklistEtapas(item, m, true)}</td>

            <td style={{ textAlign: 'center', padding: '8px 4px' }}>
              <button
                type="button"
                onClick={() => {
                  setModalFechaItem(item)
                  setFechaTemporal(fechaAsignada)
                }}
                className="pro-btn pro-btn-secondary pro-btn-sm pro-mono"
                style={{ fontSize: '10.5px', padding: '4px 7px' }}
              >
                📅 {fechaAsignada ? fechaAsignada.slice(5) : 'Fecha'}
              </button>
            </td>

            <td style={{ textAlign: 'center', padding: '8px 4px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <input
                  type="number"
                  min="1"
                  disabled={!puedeEditar}
                  key={`req-${item.ID}-${m.reqUnitaria}`}
                  defaultValue={m.reqUnitaria}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!isNaN(val) && val > 0 && val !== m.reqUnitaria) {
                      actualizarSeguimiento(item, { cantidadRequerida: val }, 'Cantidad unitaria actualizada')
                    }
                  }}
                  className="pro-input pro-mono"
                  style={{ width: '46px', textAlign: 'center', padding: '3px 4px', fontSize: '12px' }}
                />
                {m.multiplicadorPadre > 1 && (
                  <span
                    className="pro-badge pro-mono"
                    style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', fontSize: '10px', padding: '2px 5px' }}
                    title={`${m.reqUnitaria} u./ensamble × ${m.multiplicadorPadre} ensambles`}
                  >
                    Tot:{m.reqTotal}
                  </span>
                )}
              </div>
            </td>

            <td style={{ textAlign: 'center', padding: '8px 4px' }}>
              {m.tieneHijos ? (
                <span className="pro-badge pro-mono" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', fontSize: '10.5px', padding: '3px 6px' }}>
                  {m.listaTotal}/{m.reqTotal} jg
                </span>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <input
                    type="number"
                    min="0"
                    disabled={!puedeEditar}
                    key={`lst-${item.ID}-${m.listaTotal}`}
                    defaultValue={m.listaTotal}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (!isNaN(val) && val >= 0 && val !== m.listaTotal) {
                        actualizarCantidadLista(item, val)
                      }
                    }}
                    className="pro-input pro-mono"
                    style={{ width: '48px', textAlign: 'center', padding: '3px 4px', fontSize: '12px' }}
                  />
                  <span className="pro-mono" style={{ fontSize: '11px', color: '#64748b' }}>
                    /{m.reqTotal}
                  </span>
                </div>
              )}
            </td>

            <td style={{ padding: '8px 6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ flex: 1, backgroundColor: '#f1f5f9', height: '7px', borderRadius: '99px', overflow: 'hidden' }}>
                  <div style={{ width: `${m.porcentaje}%`, backgroundColor: colorBarra, height: '100%', transition: 'width 0.35s ease' }} />
                </div>
                <span className="pro-mono" style={{ fontSize: '11px', fontWeight: 700, width: '32px', textAlign: 'right' }}>
                  {m.porcentaje}%
                </span>
              </div>
            </td>

            <td style={{ textAlign: 'center', padding: '8px 4px' }}>
              <span
                className="pro-badge"
                style={{
                  fontSize: '10.5px',
                  padding: '3px 7px',
                  backgroundColor: m.porcentaje === 100 ? '#ecfdf5' : m.porcentaje > 0 ? '#eff6ff' : '#f1f5f9',
                  color: m.porcentaje === 100 ? '#065f46' : m.porcentaje > 0 ? '#1d4ed8' : '#64748b'
                }}
              >
                {m.porcentaje === 100 ? '✓ Listo' : m.porcentaje > 0 ? 'Proceso' : 'Pendiente'}
              </span>
            </td>
          </tr>
          {tieneHijosVisibles && estaAbierto && renderizarFilasGantt(item.ID, nivelProfundidad + 1, nuevosVisitados)}
        </React.Fragment>
      )
    })
  }

  // Calendario mensual MS Project
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

  const columnasKanban = [
    { id: 'pendiente', titulo: '🔴 Pendiente de Iniciar', color: '#ef4444', bgBadge: '#fef2f2' },
    { id: 'proceso', titulo: '🟡 En Fabricación / Proceso', color: '#f59e0b', bgBadge: '#fffbeb' },
    { id: 'completado', titulo: '🟢 Terminado / Listo (100%)', color: '#10b981', bgBadge: '#ecfdf5' }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Input oculto global para subir PDFs e Imágenes */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={manejarArchivoPdfSeleccionado}
        style={{ display: 'none' }}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        onChange={manejarArchivoImagenSeleccionado}
        style={{ display: 'none' }}
      />

      {/* CABECERA EJECUTIVA + SELECTOR DE LAS 3 VISTAS (OCULTABLE) */}
      <div
        className="pro-card"
        style={{
          padding: barraSuperiorVisible ? '16px 20px' : '10px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: barraSuperiorVisible ? '14px' : '0px',
          transition: 'padding 0.2s ease'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ fontSize: barraSuperiorVisible ? '16.5px' : '14px', margin: 0 }}>
              🏭 Suite de Producción y Seguimiento de Piezas
            </h3>
            {barraSuperiorVisible && (
              <p style={{ color: '#86868b', fontSize: '12.5px', margin: '3px 0 0' }}>
                Cantidades globales por ensamble · Control de etapas (Material, Maquinado, Pintado) · Planos PDF
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div className="pro-segmented">
              <button
                type="button"
                className={`pro-segmented-btn ${modoVista === 'gantt' ? 'active' : ''}`}
                onClick={() => setModoVista('gantt')}
              >
                📋 Lista BOM / Gantt
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${modoVista === 'kanban' ? 'active' : ''}`}
                onClick={() => setModoVista('kanban')}
              >
                📌 Tablero Kanban
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${modoVista === 'calendario' ? 'active' : ''}`}
                onClick={() => setModoVista('calendario')}
              >
                📅 Calendario MS Project
              </button>
            </div>

            {puedeEditar && (
              <>
                <button
                  type="button"
                  onClick={abrirNuevoElemento}
                  className="pro-btn pro-btn-primary pro-btn-sm"
                  style={{ fontSize: '11.5px', padding: '6px 11px' }}
                  title="Agregar nueva pieza o ensamble"
                >
                  ➕ Nuevo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const primero = disenosFiltrados[0] || disenos[0]
                    if (!primero) return notificar('No hay elementos para editar', 'alerta')
                    abrirEditarElemento(primero)
                  }}
                  className="pro-btn pro-btn-secondary pro-btn-sm"
                  style={{ fontSize: '11.5px', padding: '6px 11px' }}
                  title="Seleccionar un elemento para editar o eliminar"
                >
                  ✏️ Editar / Eliminar
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setBarraSuperiorVisible((v) => !v)}
              className="pro-btn pro-btn-secondary pro-btn-sm"
              style={{ fontSize: '11.5px', padding: '6px 10px' }}
              title={barraSuperiorVisible ? 'Ocultar barra de filtros' : 'Mostrar barra de filtros'}
            >
              {barraSuperiorVisible ? '🔼 Ocultar filtros' : '🔽 Mostrar filtros'}
            </button>
          </div>
        </div>

        {/* BARRA DE FILTROS + RESUMEN */}
        {barraSuperiorVisible && (
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: '210px' }}>
              <label className="pro-label">Proyecto</label>
              <select value={proyectoFiltro} onChange={(e) => setProyectoFiltro(e.target.value)} className="pro-select">
                <option value="">Todos los Proyectos</option>
                {proyectosUnicos.map((p, i) => (
                  <option key={i} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1.5, minWidth: '220px' }}>
              <label className="pro-label">Buscar Pieza o Ensamble</label>
              <input
                type="text"
                placeholder="Ej. Soporte de Torre, placa, eje..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="pro-input"
              />
            </div>

            {modoVista === 'kanban' && (
              <div style={{ minWidth: '170px' }}>
                <label className="pro-label">Nivel en Kanban</label>
                <select
                  value={filtroNivelKanban}
                  onChange={(e) => setFiltroNivelKanban(e.target.value)}
                  className="pro-select"
                >
                  <option value="TODOS">Todos los niveles</option>
                  <option value="Pieza">⚙️ Solo Piezas</option>
                  <option value="Subensamble">🧩 Subensambles</option>
                  <option value="Ensamble">📦 Ensambles</option>
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="pro-badge pro-mono" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                🔴 {resumenGlobal.pendientes}
              </span>
              <span className="pro-badge pro-mono" style={{ backgroundColor: '#fffbeb', color: '#d97706' }}>
                🟡 {resumenGlobal.enProceso}
              </span>
              <span className="pro-badge pro-mono" style={{ backgroundColor: '#ecfdf5', color: '#059669' }}>
                🟢 {resumenGlobal.completados}
              </span>
              <span className="pro-badge pro-mono" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}>
                Avance: {resumenGlobal.pctPromedio}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          VISTA 1: TABLERO KANBAN MEJORADO (TOTAL GLOBAL + 3 ETAPAS + PDF)
      ===================================================================== */}
      {modoVista === 'kanban' && (
        <div className="pro-card" style={{ padding: '20px' }}>
          <div style={{ marginBottom: '14px', fontSize: '12px', color: '#515154', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <span>
              💡 <strong>Flujo al 100%:</strong> Marca las 3 etapas (<strong>Material listo</strong>, <strong>Maquinado</strong> y <strong>Pintado</strong>) y completa la cantidad total global de piezas para pasar a <strong>Terminado (100%)</strong>.
            </span>
          </div>

          <div className="kanban-board">
            {columnasKanban.map((col) => {
              const tarjetas = itemsKanban.filter((item) => obtenerMetricasItem(item).estadoKanban === col.id)

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
                      {tarjetas.length}
                    </span>
                  </div>

                  {tarjetas.map((item) => {
                    const m = obtenerMetricasItem(item)
                    const fechaItem = obtenerFechaItem(item)
                    const faltaSoloEtapas = !m.tieneHijos && m.listaTotal >= m.reqTotal && !m.todasEtapasListas

                    return (
                      <div
                        key={item.ID}
                        className="kanban-card"
                        draggable={puedeEditar && !m.tieneHijos}
                        onDragStart={() => setItemArrastrado(item)}
                        onDragEnd={() => {
                          setItemArrastrado(null)
                          setColumnaHover(null)
                        }}
                        style={{ opacity: guardandoId === item.ID ? 0.65 : 1 }}
                      >
                        {/* Encabezado tarjeta */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {badgeNivel(item.TipoNivel)}
                            <strong style={{ fontSize: '13.5px', color: '#1d1d1f' }}>{item.Nombre}</strong>
                          </div>
                          <span className="pro-mono" style={{ fontSize: '12.5px', fontWeight: 800, color: col.color }}>
                            {m.porcentaje}%
                          </span>
                        </div>

                        {/* Proyecto y Ensamble Padre */}
                        <div style={{ fontSize: '11.5px', color: '#86868b', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span>📁 {item.Proyecto || 'Sin proyecto'}</span>
                          {m.padreDirecto && (
                            <span style={{ color: '#475569' }}>
                              ↳ {m.padreDirecto.Nombre} (×{m.multiplicadorPadre} ens.)
                            </span>
                          )}
                        </div>

                        {/* Barra de progreso */}
                        <div style={{ width: '100%', backgroundColor: '#f1f5f9', height: '7px', borderRadius: '99px', overflow: 'hidden', marginBottom: '10px' }}>
                          <div style={{ width: `${m.porcentaje}%`, backgroundColor: col.color, height: '100%', transition: 'width 0.3s ease' }} />
                        </div>

                        {/* Cantidad GLOBAL requerida vs lista */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                          <div>
                            <span className="pro-mono" style={{ fontSize: '12px', fontWeight: 700, color: '#1d1d1f' }}>
                              {m.tieneHijos ? 'Juegos' : 'Piezas'}: {m.listaTotal} / {m.reqTotal}
                            </span>
                            {m.multiplicadorPadre > 1 && (
                              <span className="pro-mono" style={{ fontSize: '10.5px', color: '#0071e3', marginLeft: '6px', fontWeight: 600 }}>
                                ({m.reqUnitaria} u. × {m.multiplicadorPadre})
                              </span>
                            )}
                          </div>

                          {puedeEditar && !m.tieneHijos && (
                            <div style={{ display: 'inline-flex', gap: '4px' }}>
                              {m.listaTotal > 0 && (
                                <button
                                  type="button"
                                  disabled={guardandoId === item.ID}
                                  onClick={() => actualizarCantidadLista(item, m.listaTotal - 1)}
                                  className="pro-btn pro-btn-secondary pro-btn-sm pro-mono"
                                  style={{ padding: '2px 7px', fontSize: '11px' }}
                                  title="Restar 1 pieza"
                                >
                                  −1
                                </button>
                              )}
                              {m.listaTotal < m.reqTotal && (
                                <button
                                  type="button"
                                  disabled={guardandoId === item.ID}
                                  onClick={() => actualizarCantidadLista(item, m.listaTotal + 1)}
                                  className="pro-btn pro-btn-primary pro-btn-sm pro-mono"
                                  style={{ padding: '2px 8px', fontSize: '11px' }}
                                  title="Sumar 1 pieza fabricada"
                                >
                                  +1
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Checklist interno de 3 etapas */}
                        <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid rgba(0,0,0,0.05)', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                              Seguimiento de proceso
                            </span>
                            {!m.tieneHijos && (
                              <span className="pro-mono" style={{ fontSize: '10.5px', fontWeight: 700, color: m.todasEtapasListas ? '#059669' : '#64748b' }}>
                                {m.etapasCompletas}/3
                              </span>
                            )}
                          </div>
                          {renderizarChecklistEtapas(item, m, false)}
                          {faltaSoloEtapas && (
                            <div style={{ marginTop: '6px', fontSize: '11px', color: '#b45309', fontWeight: 600 }}>
                              ⏳ Piezas listas; falta marcar: {m.etapasFaltantes.join(', ')}
                            </div>
                          )}
                        </div>

                        {/* Pie de tarjeta: PDF + Fecha + Editar/Eliminar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                          {renderizarControlesPdf(item, true)}

                          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setModalFechaItem(item)
                                setFechaTemporal(fechaItem)
                              }}
                              className="pro-btn pro-btn-secondary pro-btn-sm pro-mono"
                              style={{ padding: '3px 7px', fontSize: '11px' }}
                              title="Programar fecha en calendario"
                            >
                              📅 {fechaItem ? fechaItem.slice(5) : '+Fecha'}
                            </button>
                            {puedeEditar && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => abrirEditarElemento(item)}
                                  className="pro-btn pro-btn-secondary pro-btn-sm"
                                  style={{ padding: '3px 6px', fontSize: '11px' }}
                                  title="Editar elemento"
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setElementoEliminar(item)}
                                  className="pro-btn pro-btn-secondary pro-btn-sm"
                                  style={{ padding: '3px 6px', fontSize: '11px', color: '#dc2626' }}
                                  title="Eliminar elemento"
                                >
                                  🗑️
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {tarjetas.length === 0 && (
                    <div style={{ padding: '36px 12px', textAlign: 'center', color: '#86868b', fontSize: '12px', border: '1px dashed #cbd5e1', borderRadius: '10px' }}>
                      Sin elementos en esta columna
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          VISTA 2: LISTA JERÁRQUICA BOM / GANTT (CON PDFS Y 3 ETAPAS)
      ===================================================================== */}
      {modoVista === 'gantt' && (
        <div className="pro-card" style={{ padding: '14px 16px' }}>
          <div style={{ width: '100%', overflow: 'visible' }}>
            <table className="pro-table" style={{ width: '100%', tableLayout: 'fixed', minWidth: 0 }}>
              <colgroup>
                <col style={{ width: '23%' }} />
                <col style={{ width: '88px' }} />
                <col style={{ width: '236px' }} />
                <col style={{ width: '82px' }} />
                <col style={{ width: '106px' }} />
                <col style={{ width: '92px' }} />
                <col style={{ width: '106px' }} />
                <col style={{ width: '86px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ padding: '10px 8px' }}>Componente / BOM</th>
                  <th style={{ textAlign: 'center', padding: '10px 4px' }}>Plano</th>
                  <th style={{ padding: '10px 6px' }}>Etapas</th>
                  <th style={{ textAlign: 'center', padding: '10px 4px' }}>Fecha</th>
                  <th style={{ textAlign: 'center', padding: '10px 4px' }}>Unit. / Global</th>
                  <th style={{ textAlign: 'center', padding: '10px 4px' }}>Listas</th>
                  <th style={{ padding: '10px 6px' }}>Avance</th>
                  <th style={{ textAlign: 'center', padding: '10px 4px' }}>Estatus</th>
                </tr>
              </thead>
              <tbody>
                {disenosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#86868b' }}>
                      No hay componentes registrados para este filtro.
                    </td>
                  </tr>
                ) : (
                  renderizarFilasGantt()
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          VISTA 3: CALENDARIO MS PROJECT (SINCRONIZADO EN AZURE SQL)
      ===================================================================== */}
      {modoVista === 'calendario' && (
        <div className="pro-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
              Las fechas se guardan directamente en Azure SQL para todo el equipo.
            </span>
          </div>

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

              const entregablesDia = disenosFiltrados.filter((item) => obtenerFechaItem(item) === celda.fechaISO)
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
                      const m = obtenerMetricasItem(ent)
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
                            backgroundColor: m.porcentaje === 100 ? '#ecfdf5' : '#eff6ff',
                            color: m.porcentaje === 100 ? '#065f46' : '#1d4ed8',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          title={`${ent.Nombre} — ${m.listaTotal}/${m.reqTotal} (${m.porcentaje}%)`}
                        >
                          {m.porcentaje === 100 ? '✓ ' : '⚙️ '}{ent.Nombre}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ padding: '14px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
            <span className="pro-label">Piezas y ensambles sin fecha programada (Clic para agendar)</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              {disenosFiltrados
                .filter((d) => !obtenerFechaItem(d))
                .map((d) => {
                  const m = obtenerMetricasItem(d)
                  return (
                    <button
                      key={d.ID}
                      type="button"
                      onClick={() => {
                        setModalFechaItem(d)
                        setFechaTemporal(new Date().toISOString().split('T')[0])
                      }}
                      className="pro-btn pro-btn-secondary pro-btn-sm"
                    >
                      ➕ {d.Nombre} ({m.listaTotal}/{m.reqTotal})
                    </button>
                  )
                })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARA ASIGNAR FECHA COMPROMISO */}
      {modalFechaItem &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalFechaItem(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0 }}>📅 Programar Entrega</h3>
                <button type="button" onClick={() => setModalFechaItem(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
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
                    disabled={!puedeEditar}
                    onChange={(e) => setFechaTemporal(e.target.value)}
                    className="pro-input"
                  />
                </div>
              </div>
              <div className="pro-modal-footer">
                {puedeEditar && obtenerFechaItem(modalFechaItem) && (
                  <button
                    type="button"
                    onClick={() => guardarFechaCompromiso(modalFechaItem, null)}
                    className="pro-btn pro-btn-danger"
                    style={{ marginRight: 'auto' }}
                  >
                    Quitar fecha
                  </button>
                )}
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => guardarFechaCompromiso(modalFechaItem, fechaTemporal)}
                    className="pro-btn pro-btn-primary"
                  >
                    Guardar en Calendario
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* VISOR PDF CENTRADO PARA PLANOS DE DIBUJO */}
      {pdfPrevisualizando &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setPdfPrevisualizando(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '940px', height: '86vh' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0 }}>📐 Plano Técnico: {pdfPrevisualizando.nombre}</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a href={pdfPrevisualizando.urlDirecta || pdfPrevisualizando.url} target="_blank" rel="noreferrer" className="pro-btn pro-btn-primary pro-btn-sm">
                    ↗ Abrir en pestaña nueva
                  </a>
                  <button type="button" onClick={() => setPdfPrevisualizando(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
                </div>
              </div>
              <div className="pro-modal-body" style={{ flex: 1, padding: 0 }}>
                <iframe src={pdfPrevisualizando.url} title="Plano PDF" style={{ width: '100%', height: '100%', border: 'none' }} />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL PARA ELEGIR SI SUBIR PLANO PDF O IMAGEN DEL ELEMENTO */}
      {menuAdjuntoItem &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setMenuAdjuntoItem(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0 }}>📎 Adjuntar a {menuAdjuntoItem.Nombre}</h3>
                <button type="button" onClick={() => setMenuAdjuntoItem(null)} className="pro-btn pro-btn-secondary pro-btn-sm">
                  ✕
                </button>
              </div>
              <div className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ margin: 0, fontSize: '12.5px', color: '#515154' }}>
                  ¿Qué deseas subir al almacenamiento?
                </p>
                <button
                  type="button"
                  onClick={() => seleccionarArchivoPdfDirecto(menuAdjuntoItem)}
                  className="pro-btn pro-btn-secondary"
                  style={{ justifyContent: 'flex-start', gap: '10px', padding: '12px 14px' }}
                >
                  <span>📄</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>Archivo Plano PDF</div>
                    <div style={{ fontSize: '11px', color: '#86868b' }}>Plano técnico de fabricación (.pdf)</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => seleccionarImagenDirecto(menuAdjuntoItem)}
                  className="pro-btn pro-btn-secondary"
                  style={{ justifyContent: 'flex-start', gap: '10px', padding: '12px 14px' }}
                >
                  <span>🖼️</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>Imagen del elemento</div>
                    <div style={{ fontSize: '11px', color: '#86868b' }}>Foto o vista previa junto a PZA (.png, .jpg, .webp)</div>
                  </div>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* VENTANA EMERGENTE AL PASAR EL CURSOR SOBRE LA IMAGEN */}
      {imagenHover &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: Math.min(imagenHover.x + 18, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 380),
              top: Math.max(16, Math.min(imagenHover.y - 120, (typeof window !== 'undefined' ? window.innerHeight : 800) - 380)),
              zIndex: 99999,
              pointerEvents: 'none',
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              padding: '10px',
              boxShadow: '0 20px 45px rgba(0, 0, 0, 0.22)',
              border: '1px solid rgba(0, 0, 0, 0.08)',
              maxWidth: '360px'
            }}
          >
            <img
              src={imagenHover.url}
              alt={imagenHover.nombre}
              style={{
                display: 'block',
                maxWidth: '340px',
                maxHeight: '300px',
                width: 'auto',
                height: 'auto',
                borderRadius: '10px',
                objectFit: 'contain'
              }}
            />
            <div style={{ marginTop: '6px', fontSize: '12px', fontWeight: 600, color: '#1d1d1f', textAlign: 'center' }}>
              {imagenHover.nombre}
            </div>
          </div>,
          document.body
        )}

      {/* MODAL CREAR / EDITAR ELEMENTO */}
      {modalElementoAbierto &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => !guardandoCrud && setModalElementoAbierto(false)}>
            <div className="pro-modal-window" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0 }}>
                  {elementoEditando ? `✏️ Editar: ${elementoEditando.Nombre}` : '➕ Nuevo Elemento de Producción'}
                </h3>
                <button
                  type="button"
                  disabled={guardandoCrud}
                  onClick={() => setModalElementoAbierto(false)}
                  className="pro-btn pro-btn-secondary pro-btn-sm"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={guardarElementoCrud}>
                <div className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {elementoEditando && (
                    <div style={{ padding: '10px', borderRadius: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      <label className="pro-label">Elemento seleccionado para editar o eliminar</label>
                      <select
                        value={elementoEditando.ID}
                        onChange={(e) => {
                          const encontrado = disenos.find((d) => String(d.ID) === String(e.target.value))
                          if (encontrado) abrirEditarElemento(encontrado)
                        }}
                        className="pro-select"
                      >
                        {(disenosFiltrados.length > 0 ? disenosFiltrados : disenos).map((d) => (
                          <option key={d.ID} value={d.ID}>
                            [{d.TipoNivel}] {d.Nombre} {d.Proyecto ? `— ${d.Proyecto}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="pro-label">Nombre de la pieza o ensamble *</label>
                    <input
                      type="text"
                      required
                      value={nombreForm}
                      onChange={(e) => setNombreForm(e.target.value)}
                      placeholder="Ej. Soporte de Torre"
                      className="pro-input"
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label className="pro-label">Proyecto *</label>
                      <input
                        type="text"
                        required
                        list="lista-proyectos-prod"
                        value={proyectoForm}
                        onChange={(e) => setProyectoForm(e.target.value)}
                        placeholder="Nombre del proyecto"
                        className="pro-input"
                      />
                      <datalist id="lista-proyectos-prod">
                        {proyectosUnicos.map((p, idx) => (
                          <option key={idx} value={p} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="pro-label">Nivel</label>
                      <select value={tipoNivelForm} onChange={(e) => setTipoNivelForm(e.target.value)} className="pro-select">
                        <option value="Pieza">Pieza</option>
                        <option value="Subensamble">Subensamble</option>
                        <option value="Ensamble">Ensamble</option>
                        <option value="Tarea">Tarea</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="pro-label">Pertenece a (Ensamble Padre opcional)</label>
                    <select value={padreIDForm} onChange={(e) => setPadreIDForm(e.target.value)} className="pro-select">
                      <option value="">-- Ninguno (Nivel raíz) --</option>
                      {disenos
                        .filter((d) => !elementoEditando || d.ID !== elementoEditando.ID)
                        .map((d) => (
                          <option key={d.ID} value={d.ID}>
                            [{d.TipoNivel}] {d.Nombre} ({d.Proyecto})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label className="pro-label">Cantidad unitaria</label>
                      <input
                        type="number"
                        min="1"
                        value={cantidadReqForm}
                        onChange={(e) => setCantidadReqForm(e.target.value)}
                        className="pro-input pro-mono"
                      />
                    </div>
                    <div>
                      <label className="pro-label">Piezas listas</label>
                      <input
                        type="number"
                        min="0"
                        value={cantidadListaForm}
                        onChange={(e) => setCantidadListaForm(e.target.value)}
                        className="pro-input pro-mono"
                      />
                    </div>
                  </div>
                </div>
                <div className="pro-modal-footer" style={{ justifyContent: 'space-between' }}>
                  <div>
                    {elementoEditando && (
                      <button
                        type="button"
                        disabled={guardandoCrud}
                        onClick={() => {
                          const target = elementoEditando
                          setModalElementoAbierto(false)
                          setElementoEliminar(target)
                        }}
                        className="pro-btn pro-btn-secondary"
                        style={{ color: '#dc2626', borderColor: '#fecaca', backgroundColor: '#fef2f2' }}
                      >
                        🗑️ Eliminar
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={guardandoCrud}
                      onClick={() => setModalElementoAbierto(false)}
                      className="pro-btn pro-btn-secondary"
                    >
                      Cancelar
                    </button>
                    <button type="submit" disabled={guardandoCrud} className="pro-btn pro-btn-primary">
                      {guardandoCrud ? 'Guardando...' : elementoEditando ? 'Guardar cambios' : 'Agregar elemento'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL CONFIRMAR ELIMINACIÓN */}
      {elementoEliminar &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => !guardandoCrud && setElementoEliminar(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0, color: '#dc2626' }}>🗑️ Eliminar elemento</h3>
                <button
                  type="button"
                  disabled={guardandoCrud}
                  onClick={() => setElementoEliminar(null)}
                  className="pro-btn pro-btn-secondary pro-btn-sm"
                >
                  ✕
                </button>
              </div>
              <div className="pro-modal-body">
                <p style={{ margin: 0, fontSize: '13.5px', color: '#1d1d1f' }}>
                  ¿Seguro que deseas eliminar <strong>{elementoEliminar.Nombre}</strong>? Esta acción no se puede deshacer.
                </p>
              </div>
              <div className="pro-modal-footer">
                <button
                  type="button"
                  disabled={guardandoCrud}
                  onClick={() => setElementoEliminar(null)}
                  className="pro-btn pro-btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={guardandoCrud}
                  onClick={confirmarEliminarElemento}
                  className="pro-btn pro-btn-primary"
                  style={{ backgroundColor: '#dc2626', borderColor: '#dc2626' }}
                >
                  {guardandoCrud ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
