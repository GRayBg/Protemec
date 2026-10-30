import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import GlbViewer from './GlbViewer'

export default function GestionKanban({
  disenos = [],
  proyectosUnicos = [],
  movimientosAlmacen = [],
  API_URL,
  recargarDatos,
  mostrarToast,
  puedeEditar = true,
  usuarioActual = null
}) {
  // Filtros de navegación
  const [proyectoFiltro, setProyectoFiltro] = useState(() => proyectosUnicos[0] || '')
  const [busqueda, setBusqueda] = useState('')
  const [filtroNivel, setFiltroNivel] = useState('TODOS')
  const [filtroPadreId, setFiltroPadreId] = useState('')
  const [vistaActiva, setVistaActiva] = useState('kanban') // 'kanban' | 'salidas' | 'calendario'

  // Drag & Drop
  const [itemArrastrado, setItemArrastrado] = useState(null)
  const [columnaHover, setColumnaHover] = useState(null)

  // Modales
  // 1. Modal de Registro de Conteo y Vinculación con Almacén
  const [modalConteoItem, setModalConteoItem] = useState(null)
  const [cantidadSumar, setCantidadSumar] = useState('1')
  const [notasConteo, setNotasConteo] = useState('')
  const [salidaSeleccionadaParaConteo, setSalidaSeleccionadaParaConteo] = useState(null)
  const [cantidadSalidaParcial, setCantidadSalidaParcial] = useState('')

  // 2. Modal de Alta / Edición de Tarea o Pieza
  const [modalTareaAbierto, setModalTareaAbierto] = useState(false)
  const [tareaEditando, setTareaEditando] = useState(null)
  const [nombreForm, setNombreForm] = useState('')
  const [proyectoForm, setProyectoForm] = useState('')
  const [tipoNivelForm, setTipoNivelForm] = useState('Pieza')
  const [padreIDForm, setPadreIDForm] = useState('')
  const [cantidadRequeridaForm, setCantidadRequeridaForm] = useState(1)
  const [cantidadListaForm, setCantidadListaForm] = useState(0)

  // 3. Modal de Vinculación Directa desde Salida de Almacén hacia Tarea Existente
  const [modalVincularSalida, setModalVincularSalida] = useState(null)
  const [tareaDestinoId, setTareaDestinoId] = useState('')
  const [cantidadImputarSalida, setCantidadImputarSalida] = useState('')

  // 4. Modales de Visualización 3D y Plano PDF
  const [itemFlotante3D, setItemFlotante3D] = useState(null)
  const [pdfPrevisualizando, setPdfPrevisualizando] = useState(null)

  // 5. Calendario y Fechas
  const [fechasCompromiso, setFechasCompromiso] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('protemec_bom_fechas') || '{}')
    } catch {
      return {}
    }
  })
  const [modalFechaItem, setModalFechaItem] = useState(null)
  const [fechaTemporal, setFechaTemporal] = useState('')
  const [mesActual, setMesActual] = useState(() => {
    const hoy = new Date()
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  })

  // 6. Modal Confirmar Eliminación
  const [itemParaEliminar, setItemParaEliminar] = useState(null)
  const [guardando, setGuardando] = useState(false)

  // Persistir fechas de calendario
  useEffect(() => {
    localStorage.setItem('protemec_bom_fechas', JSON.stringify(fechasCompromiso))
  }, [fechasCompromiso])

  const notificar = (msg, tipo = 'exito') => {
    if (mostrarToast) mostrarToast(msg, tipo)
  }

  // Helper para obtener la bitácora de conteo del ítem
  const parsearBitacora = useCallback((item) => {
    if (!item) return []
    if (item.BitacoraConteoJSON) {
      try {
        const parsed = typeof item.BitacoraConteoJSON === 'string'
          ? JSON.parse(item.BitacoraConteoJSON)
          : item.BitacoraConteoJSON
        if (Array.isArray(parsed)) return parsed
      } catch {
        // Fallback local
      }
    }
    // Backup en localStorage
    try {
      const backup = localStorage.getItem(`protemec_kanban_bitacora_${item.ID}`)
      return backup ? JSON.parse(backup) : []
    } catch {
      return []
    }
  }, [])

  // Ensambles y subensambles disponibles en el proyecto seleccionado
  const ensamblesDelProyecto = useMemo(() => {
    return disenos.filter(
      (d) =>
        (d.TipoNivel === 'Ensamble' || d.TipoNivel === 'Subensamble') &&
        (!proyectoFiltro || d.Proyecto === proyectoFiltro)
    )
  }, [disenos, proyectoFiltro])

  // Posibles ensambles padre al crear o editar una tarea
  const padresDisponibles = useMemo(() => {
    return disenos.filter(
      (d) =>
        (d.TipoNivel === 'Ensamble' || d.TipoNivel === 'Subensamble') &&
        (!proyectoForm || d.Proyecto === proyectoForm) &&
        (!tareaEditando || d.ID !== tareaEditando.ID)
    )
  }, [disenos, proyectoForm, tareaEditando])

  // Conteo de ítems según su nivel jerárquico para el selector
  const conteoPorNivel = useMemo(() => {
    const base = disenos.filter((d) => (proyectoFiltro ? d.Proyecto === proyectoFiltro : true))
    return {
      ensambles: base.filter((d) => d.TipoNivel === 'Ensamble').length,
      subensambles: base.filter((d) => d.TipoNivel === 'Subensamble').length,
      piezas: base.filter((d) => d.TipoNivel === 'Pieza').length,
      tareas: base.filter((d) => d.TipoNivel === 'Tarea').length,
      total: base.length
    }
  }, [disenos, proyectoFiltro])

  // Filtrado inteligente por proyecto, nivel, ensamble padre y texto
  const itemsFiltrados = useMemo(() => {
    return disenos.filter((d) => {
      const coincideProyecto = proyectoFiltro ? d.Proyecto === proyectoFiltro : true
      const coincideNivel = filtroNivel !== 'TODOS' ? d.TipoNivel === filtroNivel : true
      const coincidePadre = filtroPadreId ? String(d.PadreID) === String(filtroPadreId) : true
      const q = busqueda.trim().toLowerCase()
      const coincideTexto = q
        ? String(d.Nombre || '').toLowerCase().includes(q) ||
          String(d.Proyecto || '').toLowerCase().includes(q) ||
          String(d.TipoNivel || '').toLowerCase().includes(q)
        : true
      return coincideProyecto && coincideNivel && coincidePadre && coincideTexto
    })
  }, [disenos, proyectoFiltro, filtroNivel, filtroPadreId, busqueda])

  // Salidas de Almacén correspondientes al proyecto
  const salidasProyecto = useMemo(() => {
    return movimientosAlmacen.filter((m) => {
      const esSalida = m.TipoMovimiento === 'Salida Consumo' || m.TipoMovimiento === 'Prestamo Herramienta'
      const coincideProyecto = proyectoFiltro ? m.Proyecto === proyectoFiltro : true
      return esSalida && coincideProyecto
    })
  }, [movimientosAlmacen, proyectoFiltro])

  // Métricas de cada ítem
  const obtenerMetricasItem = useCallback((item) => {
    const tieneHijos = disenos.some((h) => h.PadreID === item.ID)
    const reqUnitaria = Math.max(1, item.CantidadRequerida || 1)
    let listaTotal = item.CantidadLista || 0

    if (tieneHijos) {
      // Calcular a partir de los hijos
      const hijos = disenos.filter((h) => h.PadreID === item.ID)
      let conjuntosPosibles = Infinity
      hijos.forEach((hijo) => {
        const reqHijo = hijo.CantidadRequerida || 1
        const cantHijo = hijo.CantidadLista || 0
        const aportados = Math.floor(cantHijo / reqHijo)
        if (aportados < conjuntosPosibles) conjuntosPosibles = aportados
      })
      if (conjuntosPosibles === Infinity) conjuntosPosibles = 0
      listaTotal = conjuntosPosibles
    }

    const porcentaje = Math.min(100, Math.round((listaTotal / reqUnitaria) * 100))
    const estadoKanban = porcentaje >= 100 ? 'completado' : porcentaje > 0 ? 'proceso' : 'pendiente'
    const faltantes = Math.max(0, reqUnitaria - listaTotal)
    const bitacora = parsearBitacora(item)
    const ultimoRegistro = bitacora.length > 0 ? bitacora[bitacora.length - 1] : null

    return { tieneHijos, reqUnitaria, listaTotal, porcentaje, estadoKanban, faltantes, bitacora, ultimoRegistro }
  }, [disenos, parsearBitacora])

  // Métricas Globales del Proyecto
  const metricasGlobales = useMemo(() => {
    let totalReq = 0
    let totalLista = 0
    let totalItems = itemsFiltrados.length
    let pendientes = 0
    let enProceso = 0
    let completados = 0

    itemsFiltrados.forEach((item) => {
      const m = obtenerMetricasItem(item)
      totalReq += m.reqUnitaria
      totalLista += Math.min(m.listaTotal, m.reqUnitaria)
      if (m.estadoKanban === 'pendiente') pendientes++
      else if (m.estadoKanban === 'proceso') enProceso++
      else if (m.estadoKanban === 'completado') completados++
    })

    const pctGlobal = totalReq > 0 ? Math.min(100, Math.round((totalLista / totalReq) * 100)) : 0
    return { totalReq, totalLista, totalItems, pendientes, enProceso, completados, pctGlobal }
  }, [itemsFiltrados, obtenerMetricasItem])

  // Actualizar cantidades y bitácora en Azure SQL
  const persistirAvanceConBitacora = async (id, nuevaLista, nuevaRequerida, bitacoraActualizada = null, mensajeExito = null) => {
    if (!puedeEditar) return notificar('Modo solo lectura: no puedes modificar avances', 'alerta')
    try {
      setGuardando(true)
      const payload = {
        cantidadLista: nuevaLista,
        cantidadRequerida: nuevaRequerida
      }
      if (bitacoraActualizada) {
        payload.bitacoraConteo = bitacoraActualizada
        // Guardar backup local en localStorage
        try {
          localStorage.setItem(`protemec_kanban_bitacora_${id}`, JSON.stringify(bitacoraActualizada))
        } catch {
          // Ignore
        }
      }

      const res = await fetch(`${API_URL}/api/ingenieria/${id}/avance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) throw new Error('No se pudo actualizar el avance en el servidor')
      if (recargarDatos) recargarDatos()
      notificar(mensajeExito || 'Avance y conteo actualizados en Azure SQL')
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  // MANEJO DE DRAG & DROP
  const manejarDropKanban = (columnaDestino) => {
    setColumnaHover(null)
    if (!itemArrastrado || !puedeEditar) return

    const { tieneHijos, reqUnitaria, bitacora } = obtenerMetricasItem(itemArrastrado)
    if (tieneHijos) {
      notificar('Los ensambles padre calculan su avance automáticamente a partir de sus componentes hijos', 'alerta')
      setItemArrastrado(null)
      return
    }

    let nuevaCantidadLista = 0
    let notasCambio = ''
    if (columnaDestino === 'pendiente') {
      nuevaCantidadLista = 0
      notasCambio = 'Reiniciado a Pendiente desde Tablero Kanban'
    } else if (columnaDestino === 'proceso') {
      nuevaCantidadLista = Math.max(1, Math.floor(reqUnitaria / 2))
      if (reqUnitaria === 1) {
        notificar('Para ítems de 1 unidad, usa "Registrar Conteo" o arrastra a Completado', 'alerta')
        setItemArrastrado(null)
        return
      }
      notasCambio = `Avance al 50% (${nuevaCantidadLista}/${reqUnitaria} u.) desde Tablero Kanban`
    } else if (columnaDestino === 'completado') {
      nuevaCantidadLista = reqUnitaria
      notasCambio = `Marcado al 100% completado (${reqUnitaria}/${reqUnitaria} u.) desde Tablero Kanban`
    }

    const nuevoRegistro = {
      fecha: new Date().toISOString(),
      cantidadSumada: nuevaCantidadLista,
      esAbsoluto: true,
      origen: 'Arrastre en Tablero Kanban',
      usuario: usuarioActual?.nombre || usuarioActual?.usuario || 'Operador',
      notas: notasCambio
    }
    const bitacoraNueva = [...bitacora, nuevoRegistro]

    persistirAvanceConBitacora(
      itemArrastrado.ID,
      nuevaCantidadLista,
      reqUnitaria,
      bitacoraNueva,
      `Estado actualizado a "${columnaDestino.toUpperCase()}"`
    )
    setItemArrastrado(null)
  }

  // REGISTRO DE CONTEO (MANUAL O DESDE SALIDA DE ALMACÉN)
  const abrirModalConteo = (item) => {
    setModalConteoItem(item)
    const { faltantes } = obtenerMetricasItem(item)
    setCantidadSumar(faltantes > 0 ? String(Math.min(faltantes, 1)) : '1')
    setNotasConteo('')
    setSalidaSeleccionadaParaConteo(null)
    setCantidadSalidaParcial('')
  }

  const aplicarConteoManual = async (e) => {
    e.preventDefault()
    if (!modalConteoItem || !puedeEditar) return

    const cantNum = parseInt(cantidadSumar, 10)
    if (isNaN(cantNum) || cantNum <= 0) {
      notificar('Ingresa una cantidad válida mayor a 0', 'alerta')
      return
    }

    const { reqUnitaria, listaTotal, bitacora } = obtenerMetricasItem(modalConteoItem)
    const nuevaLista = Math.min(reqUnitaria, listaTotal + cantNum)

    const nuevoRegistro = {
      fecha: new Date().toISOString(),
      cantidadSumada: cantNum,
      origen: 'Conteo Manual en Taller / Planta',
      usuario: usuarioActual?.nombre || usuarioActual?.usuario || 'Operador',
      notas: notasConteo.trim() || `Registro manual de +${cantNum} u.`
    }
    const bitacoraNueva = [...bitacora, nuevoRegistro]

    await persistirAvanceConBitacora(
      modalConteoItem.ID,
      nuevaLista,
      reqUnitaria,
      bitacoraNueva,
      `Conteo registrado: +${cantNum} unidades a "${modalConteoItem.Nombre}"`
    )
    setModalConteoItem(null)
  }

  const imputarSalidaAlmacenAConteo = async (salida) => {
    if (!modalConteoItem || !puedeEditar) return

    const cantImputar = parseInt(cantidadSalidaParcial, 10) || salida.Cantidad || 1
    if (cantImputar <= 0) {
      notificar('Cantidad inválida para imputar', 'alerta')
      return
    }

    const { reqUnitaria, listaTotal, bitacora } = obtenerMetricasItem(modalConteoItem)
    const nuevaLista = Math.min(reqUnitaria, listaTotal + cantImputar)

    const fechaSalidaFormateada = salida.FechaMovimiento ? new Date(salida.FechaMovimiento).toLocaleDateString('es-MX') : ''
    const nuevoRegistro = {
      fecha: new Date().toISOString(),
      cantidadSumada: cantImputar,
      origen: `Salida de Almacén: ${salida.NombreProducto || 'Material'}`,
      movimientoId: salida.MovimientoID || null,
      empleadoReceptor: salida.NombreEmpleado || 'Planta',
      usuarioERP: salida.UsuarioERP || 'Almacén',
      usuario: usuarioActual?.nombre || usuarioActual?.usuario || 'Operador',
      notas: `Salida de Almacén #${salida.MovimientoID || ''} (${cantImputar} u.) del ${fechaSalidaFormateada}. ${salida.Notas ? `Notas Almacén: ${salida.Notas}` : ''}`
    }
    const bitacoraNueva = [...bitacora, nuevoRegistro]

    await persistirAvanceConBitacora(
      modalConteoItem.ID,
      nuevaLista,
      reqUnitaria,
      bitacoraNueva,
      `Salida de almacén vinculada: +${cantImputar} u. de "${salida.NombreProducto}" sumadas a "${modalConteoItem.Nombre}"`
    )
    setModalConteoItem(null)
  }

  // ACCIÓN DESDE LA PESTAÑA DE SALIDAS DE ALMACÉN
  const abrirModalVincularSalida = (salida) => {
    setModalVincularSalida(salida)
    setCantidadImputarSalida(String(salida.Cantidad || 1))
    // Auto seleccionar el primer ítem si coincide
    const primerCoincidente = itemsFiltrados[0]
    setTareaDestinoId(primerCoincidente ? String(primerCoincidente.ID) : '')
  }

  const ejecutarVinculacionSalida = async (e) => {
    e.preventDefault()
    if (!modalVincularSalida || !tareaDestinoId) {
      notificar('Selecciona una tarea o pieza destino', 'alerta')
      return
    }

    const itemDestino = disenos.find((d) => String(d.ID) === String(tareaDestinoId))
    if (!itemDestino) return

    const cantImputar = parseInt(cantidadImputarSalida, 10) || modalVincularSalida.Cantidad || 1
    const { reqUnitaria, listaTotal, bitacora } = obtenerMetricasItem(itemDestino)
    const nuevaLista = Math.min(reqUnitaria, listaTotal + cantImputar)

    const fechaSalidaFormateada = modalVincularSalida.FechaMovimiento
      ? new Date(modalVincularSalida.FechaMovimiento).toLocaleDateString('es-MX')
      : ''

    const nuevoRegistro = {
      fecha: new Date().toISOString(),
      cantidadSumada: cantImputar,
      origen: `Salida de Almacén: ${modalVincularSalida.NombreProducto}`,
      movimientoId: modalVincularSalida.MovimientoID || null,
      empleadoReceptor: modalVincularSalida.NombreEmpleado || 'Planta',
      usuario: usuarioActual?.nombre || usuarioActual?.usuario || 'Operador',
      notas: `Imputado desde panel de Almacén: ${cantImputar} u. de "${modalVincularSalida.NombreProducto}" (${fechaSalidaFormateada})`
    }
    const bitacoraNueva = [...bitacora, nuevoRegistro]

    await persistirAvanceConBitacora(
      itemDestino.ID,
      nuevaLista,
      reqUnitaria,
      bitacoraNueva,
      `Salida vinculada: +${cantImputar} u. sumadas a "${itemDestino.Nombre}"`
    )
    setModalVincularSalida(null)
  }

  // Convertir una salida de almacén directamente en una nueva tarjeta del Kanban
  const convertirSalidaEnTarjetaKanban = async (salida) => {
    if (!puedeEditar) return notificar('Sin permisos de creación', 'alerta')

    const nombreSugerido = salida.NombreProducto || 'Partida de Almacén'
    const proy = salida.Proyecto || proyectoFiltro || proyectosUnicos[0] || 'General'
    const cant = salida.Cantidad || 1

    try {
      setGuardando(true)
      const bitacoraInicial = [
        {
          fecha: new Date().toISOString(),
          cantidadSumada: cant,
          origen: `Creada a partir de Salida de Almacén #${salida.MovimientoID || ''}`,
          usuario: usuarioActual?.nombre || usuarioActual?.usuario || 'Operador',
          notas: `Salida de almacén de ${cant} u. para "${salida.NombreProducto}". Recibió: ${salida.NombreEmpleado || 'Taller'}`
        }
      ]

      const formData = new FormData()
      formData.append('nombre', nombreSugerido)
      formData.append('proyecto', proy)
      formData.append('tipoNivel', 'Pieza')
      formData.append('cantidadRequerida', cant)
      formData.append('cantidadLista', cant) // Ya salió de almacén, llega lista a planta
      formData.append('bitacoraConteo', JSON.stringify(bitacoraInicial))

      const res = await fetch(`${API_URL}/api/ingenieria`, {
        method: 'POST',
        body: formData
      })
      if (!res.ok) throw new Error('No se pudo crear la tarjeta')

      if (recargarDatos) recargarDatos()
      notificar(`✅ Tarjeta "${nombreSugerido}" creada en el Kanban con ${cant} u. listas`)
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  // GESTIÓN DE NUEVA TAREA / PIEZA
  const abrirModalCrearTarea = () => {
    if (!puedeEditar) return notificar('Tu perfil no tiene permisos para crear tareas', 'alerta')
    setTareaEditando(null)
    setNombreForm('')
    setProyectoForm(proyectoFiltro || proyectosUnicos[0] || '')
    setTipoNivelForm('Pieza')
    setPadreIDForm('')
    setCantidadRequeridaForm(1)
    setCantidadListaForm(0)
    setModalTareaAbierto(true)
  }

  const abrirModalEditarTarea = (item) => {
    if (!puedeEditar) return notificar('Tu perfil no tiene permisos para editar', 'alerta')
    setTareaEditando(item)
    setNombreForm(item.Nombre || '')
    setProyectoForm(item.Proyecto || '')
    setTipoNivelForm(item.TipoNivel || 'Pieza')
    setPadreIDForm(item.PadreID ? String(item.PadreID) : '')
    setCantidadRequeridaForm(item.CantidadRequerida || 1)
    setCantidadListaForm(item.CantidadLista || 0)
    setModalTareaAbierto(true)
  }

  const guardarTareaModal = async (e) => {
    e.preventDefault()
    if (!puedeEditar) return notificar('Sin permisos de edición', 'error')
    if (!proyectoForm || !nombreForm.trim()) {
      notificar('Ingresa el proyecto y nombre de la tarea o pieza', 'alerta')
      return
    }

    try {
      setGuardando(true)
      const formData = new FormData()
      formData.append('nombre', nombreForm.trim())
      formData.append('proyecto', proyectoForm)
      formData.append('tipoNivel', tipoNivelForm)
      formData.append('cantidadRequerida', cantidadRequeridaForm || 1)
      formData.append('cantidadLista', cantidadListaForm || 0)

      const padreAEnviar = (tipoNivelForm === 'Subensamble' || tipoNivelForm === 'Pieza') ? (padreIDForm || '') : ''
      formData.append('padreID', padreAEnviar)

      if (tareaEditando) {
        if (tareaEditando.UrlGLB) formData.append('urlGlbActual', tareaEditando.UrlGLB)
        if (tareaEditando.UrlPDF) formData.append('urlPdfActual', tareaEditando.UrlPDF)

        const res = await fetch(`${API_URL}/api/ingenieria/${tareaEditando.ID}`, {
          method: 'PUT',
          body: formData
        })
        if (!res.ok) throw new Error('Error al actualizar la tarea')
        notificar('Tarea actualizada correctamente')
      } else {
        const bitacoraInicial = [
          {
            fecha: new Date().toISOString(),
            cantidadSumada: parseInt(cantidadListaForm, 10) || 0,
            origen: 'Creación directa en Tablero Kanban',
            usuario: usuarioActual?.nombre || usuarioActual?.usuario || 'Operador',
            notas: `Alta de tarea en Kanban con meta de ${cantidadRequeridaForm} u.`
          }
        ]
        formData.append('bitacoraConteo', JSON.stringify(bitacoraInicial))

        const res = await fetch(`${API_URL}/api/ingenieria`, {
          method: 'POST',
          body: formData
        })
        if (!res.ok) throw new Error('Error al crear la tarea')
        notificar('Nueva tarea registrada en el Tablero Kanban')
      }

      setModalTareaAbierto(false)
      if (recargarDatos) recargarDatos()
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  // ELIMINACIÓN
  const confirmarEliminarItem = async () => {
    if (!itemParaEliminar || !puedeEditar) return
    try {
      setGuardando(true)
      const res = await fetch(`${API_URL}/api/ingenieria/${itemParaEliminar.ID}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar el ítem')

      notificar('Ítem eliminado del tablero')
      setItemParaEliminar(null)
      if (recargarDatos) recargarDatos()
    } catch (err) {
      notificar(err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  // Columnas Kanban
  const columnasKanban = [
    {
      id: 'pendiente',
      titulo: '⏳ Pendiente',
      subtitulo: '0% de avance',
      color: '#64748b',
      bgBadge: '#f1f5f9',
      borderCard: '#cbd5e1'
    },
    {
      id: 'proceso',
      titulo: '⚙️ En Proceso',
      subtitulo: '1% a 99% completado',
      color: '#0071e3',
      bgBadge: '#eff6ff',
      borderCard: '#93c5fd'
    },
    {
      id: 'completado',
      titulo: '✅ Completado',
      subtitulo: '100% terminado',
      color: '#059669',
      bgBadge: '#ecfdf5',
      borderCard: '#86efac'
    }
  ]

  const badgeNivel = (nivel) => {
    if (nivel === 'Ensamble') return <span className="pro-badge" style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>📦 Ensamble</span>
    if (nivel === 'Subensamble') return <span className="pro-badge" style={{ backgroundColor: '#e0e7ff', color: '#4338ca' }}>🧩 Subensamble</span>
    if (nivel === 'Tarea') return <span className="pro-badge" style={{ backgroundColor: '#f3e8ff', color: '#7e22ce' }}>📝 Tarea</span>
    return <span className="pro-badge" style={{ backgroundColor: '#f1f5f9', color: '#475569' }}>⚙️ Pieza</span>
  }

  // Calendario Helpers
  const construirDiasCalendario = () => {
    const anio = mesActual.getFullYear()
    const mes = mesActual.getMonth()
    const primerDiaSemana = new Date(anio, mes, 1).getDay()
    const diasEnMes = new Date(anio, mes + 1, 0).getDate()

    const dias = []
    for (let i = 0; i < primerDiaSemana; i++) {
      dias.push(null)
    }
    for (let d = 1; d <= diasEnMes; d++) {
      const fechaISO = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      dias.push({ dia: d, fechaISO })
    }
    return dias
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* =========================================================================
          BANNER DE CONTROL SUPERIOR CON MÉTRICAS DEL PROYECTO
      ========================================================================= */}
      <div className="pro-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '24px' }}>📋</span>
              <div>
                <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700, color: '#1d1d1f' }}>
                  Tablero Kanban y Control de Avance en Planta
                </h2>
                <span style={{ fontSize: '12.5px', color: '#86868b' }}>
                  Gestión operativa por proyecto · Registro de conteo · Vinculación directa con salidas de almacén
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="pro-segmented">
              <button
                type="button"
                className={`pro-segmented-btn ${vistaActiva === 'kanban' ? 'active' : ''}`}
                onClick={() => setVistaActiva('kanban')}
              >
                📌 Tablero Kanban
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${vistaActiva === 'salidas' ? 'active' : ''}`}
                onClick={() => setVistaActiva('salidas')}
              >
                📦 Salidas de Almacén ({salidasProyecto.length})
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${vistaActiva === 'calendario' ? 'active' : ''}`}
                onClick={() => setVistaActiva('calendario')}
              >
                📅 Calendario
              </button>
            </div>

            {puedeEditar && (
              <button
                type="button"
                onClick={abrirModalCrearTarea}
                className="pro-btn pro-btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span>➕</span>
                <span>Nueva Tarea / Pieza</span>
              </button>
            )}
          </div>
        </div>

        {/* FILTROS DE PROYECTO, BÚSQUEDA Y CONTROL JERÁRQUICO */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1.2fr) 1.8fr', gap: '14px', alignItems: 'end' }}>
            <div>
              <label className="pro-label" style={{ fontWeight: 600 }}>📁 Proyecto Seleccionado</label>
              <select
                value={proyectoFiltro}
                onChange={(e) => {
                  setProyectoFiltro(e.target.value)
                  setFiltroPadreId('')
                }}
                className="pro-select"
                style={{ fontWeight: 600 }}
              >
                <option value="">-- Todos los Proyectos --</option>
                {proyectosUnicos.map((p, i) => (
                  <option key={i} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="pro-label">Buscar en el Tablero</label>
              <input
                type="text"
                placeholder="Buscar por nombre de pieza, tarea o descripción..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="pro-input"
              />
            </div>
          </div>

          {/* FILTRO SELECTOR POR NIVEL JERÁRQUICO (EVITA SATURACIÓN Y DUPLICACIÓN) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingTop: '8px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#515154' }}>
                Vista por Nivel BOM:
              </span>
              <div className="pro-segmented" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroNivel === 'Ensamble' ? 'active' : ''}`}
                  onClick={() => setFiltroNivel('Ensamble')}
                  title="Muestra solo los ensambles completos de alto nivel"
                >
                  📦 Ensambles Principales ({conteoPorNivel.ensambles})
                </button>
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroNivel === 'Subensamble' ? 'active' : ''}`}
                  onClick={() => setFiltroNivel('Subensamble')}
                  title="Muestra subconjuntos intermedios"
                >
                  🧩 Subensambles ({conteoPorNivel.subensambles})
                </button>
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroNivel === 'Pieza' ? 'active' : ''}`}
                  onClick={() => setFiltroNivel('Pieza')}
                  title="Muestra las piezas individuales que se maquinan o fabrican"
                >
                  ⚙️ Piezas Sueltas ({conteoPorNivel.piezas})
                </button>
                {conteoPorNivel.tareas > 0 && (
                  <button
                    type="button"
                    className={`pro-segmented-btn ${filtroNivel === 'Tarea' ? 'active' : ''}`}
                    onClick={() => setFiltroNivel('Tarea')}
                  >
                    📝 Tareas ({conteoPorNivel.tareas})
                  </button>
                )}
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroNivel === 'TODOS' ? 'active' : ''}`}
                  onClick={() => setFiltroNivel('TODOS')}
                  title="Ver todos los niveles juntos"
                >
                  👁️ Ver Todo ({conteoPorNivel.total})
                </button>
              </div>
            </div>

            {/* FILTRO DE DESGLOSE POR ENSAMBLE PADRE */}
            {ensamblesDelProyecto.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                  Desglosar Ensamble:
                </span>
                <select
                  value={filtroPadreId}
                  onChange={(e) => setFiltroPadreId(e.target.value)}
                  className="pro-select"
                  style={{ fontSize: '12px', padding: '6px 10px', minWidth: '180px' }}
                >
                  <option value="">-- Todos los Ensambles --</option>
                  {ensamblesDelProyecto.map((ens) => (
                    <option key={ens.ID} value={ens.ID}>
                      [{ens.TipoNivel}] {ens.Nombre}
                    </option>
                  ))}
                </select>
                {filtroPadreId && (
                  <button
                    type="button"
                    onClick={() => setFiltroPadreId('')}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    ✕ Limpiar
                  </button>
                )}
              </div>
            )}
          </div>

          {/* BANNER INFORMATIVO SI ESTÁ FILTRANDO POR ENSAMBLE PADRE */}
          {filtroPadreId && (() => {
            const padreActivo = ensamblesDelProyecto.find((e) => String(e.ID) === String(filtroPadreId))
            return (
              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px', color: '#1e40af' }}>
                <span>
                  🔍 Desglose activo: Mostrando únicamente los componentes que forman parte de <strong>&ldquo;{padreActivo?.Nombre || `ID #${filtroPadreId}`}&rdquo;</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setFiltroPadreId('')}
                  className="pro-btn pro-btn-secondary pro-btn-sm"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                >
                  ✕ Mostrar todos los componentes
                </button>
              </div>
            )
          })()}
        </div>

        {/* RESUMEN DE PROGRESO GLOBAL DEL PROYECTO */}
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
          <div style={{ backgroundColor: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Progreso Global</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '2px' }}>
              <span className="pro-mono" style={{ fontSize: '20px', fontWeight: 800, color: metricasGlobales.pctGlobal === 100 ? '#059669' : '#0071e3' }}>
                {metricasGlobales.pctGlobal}%
              </span>
              <span style={{ fontSize: '11.5px', color: '#86868b' }}>
                ({metricasGlobales.totalLista} de {metricasGlobales.totalReq} u.)
              </span>
            </div>
            <div style={{ width: '100%', height: '5px', backgroundColor: '#e2e8f0', borderRadius: '99px', overflow: 'hidden', marginTop: '6px' }}>
              <div style={{ width: `${metricasGlobales.pctGlobal}%`, height: '100%', backgroundColor: metricasGlobales.pctGlobal === 100 ? '#10b981' : '#0071e3', transition: 'width 0.4s ease' }} />
            </div>
          </div>

          <div style={{ backgroundColor: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Ítems en Tablero</span>
            <div className="pro-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#1d1d1f', marginTop: '2px' }}>
              {metricasGlobales.totalItems}
            </div>
            <span style={{ fontSize: '11px', color: '#86868b' }}>Tarjetas configuradas</span>
          </div>

          <div style={{ backgroundColor: '#fffbeb', padding: '10px 14px', borderRadius: '10px', border: '1px solid #fef3c7' }}>
            <span style={{ fontSize: '11px', color: '#92400e', textTransform: 'uppercase', fontWeight: 600 }}>⏳ Pendientes</span>
            <div className="pro-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#b45309', marginTop: '2px' }}>
              {metricasGlobales.pendientes}
            </div>
            <span style={{ fontSize: '11px', color: '#92400e' }}>Aún sin iniciar</span>
          </div>

          <div style={{ backgroundColor: '#eff6ff', padding: '10px 14px', borderRadius: '10px', border: '1px solid #dbeafe' }}>
            <span style={{ fontSize: '11px', color: '#1e40af', textTransform: 'uppercase', fontWeight: 600 }}>⚙️ En Fabricación</span>
            <div className="pro-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#0071e3', marginTop: '2px' }}>
              {metricasGlobales.enProceso}
            </div>
            <span style={{ fontSize: '11px', color: '#1e40af' }}>Con avance parcial</span>
          </div>

          <div style={{ backgroundColor: '#ecfdf5', padding: '10px 14px', borderRadius: '10px', border: '1px solid #d1fae5' }}>
            <span style={{ fontSize: '11px', color: '#065f46', textTransform: 'uppercase', fontWeight: 600 }}>✅ Terminadas</span>
            <div className="pro-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#059669', marginTop: '2px' }}>
              {metricasGlobales.completados}
            </div>
            <span style={{ fontSize: '11px', color: '#065f46' }}>Meta 100% alcanzada</span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          VISTA 1: TABLERO KANBAN DRAG & DROP
      ========================================================================= */}
      {vistaActiva === 'kanban' && (
        <div>
          <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px', color: '#515154' }}>
            <div>
              💡 <strong>Instrucciones rápidas:</strong> Arrastra tarjetas entre columnas para cambiar su estado. Presiona <strong>🔢 Registrar Conteo</strong> para sumar piezas terminadas o vincular lo que salió del almacén.
            </div>
            {salidasProyecto.length > 0 && (
              <button
                type="button"
                onClick={() => setVistaActiva('salidas')}
                className="pro-badge"
                style={{ backgroundColor: '#eff6ff', color: '#0071e3', border: '1px solid #bfdbfe', cursor: 'pointer', padding: '4px 10px', fontSize: '12px' }}
              >
                📦 Hay {salidasProyecto.length} salidas de almacén para este proyecto →
              </button>
            )}
          </div>

          <div className="kanban-board">
            {columnasKanban.map((col) => {
              const itemsColumna = itemsFiltrados.filter(
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
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingBottom: '10px',
                      borderBottom: '1px solid rgba(0,0,0,0.06)'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '14px', color: '#1d1d1f' }}>{col.titulo}</strong>
                      <div style={{ fontSize: '11px', color: '#86868b' }}>{col.subtitulo}</div>
                    </div>
                    <span className="pro-badge pro-mono" style={{ backgroundColor: col.bgBadge, color: col.color, fontWeight: 700 }}>
                      {itemsColumna.length}
                    </span>
                  </div>

                  {itemsColumna.length === 0 ? (
                    <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '12px', border: '1px dashed #cbd5e1', borderRadius: '10px', marginTop: '10px' }}>
                      Arrastra ítems aquí
                    </div>
                  ) : null}

                  {itemsColumna.map((item) => {
                    const { tieneHijos, reqUnitaria, listaTotal, porcentaje, faltantes, ultimoRegistro } = obtenerMetricasItem(item)
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
                        style={{
                          borderLeft: `4px solid ${col.color}`,
                          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        {/* CABECERA DE LA TARJETA */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {badgeNivel(item.TipoNivel)}
                            <strong style={{ fontSize: '13.5px', color: '#1d1d1f', wordBreak: 'break-word' }}>
                              {item.Nombre}
                            </strong>
                          </div>
                          <span className="pro-mono" style={{ fontSize: '13px', fontWeight: 800, color: col.color }}>
                            {porcentaje}%
                          </span>
                        </div>

                        {/* PROYECTO Y ENSAMBLE PADRE */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>📁</span>
                            <span>{item.Proyecto || 'Sin proyecto'}</span>
                          </div>

                          {/* SI PERTENECE A UN ENSAMBLE PADRE */}
                          {item.PadreID && (() => {
                            const padreObj = disenos.find((p) => p.ID === item.PadreID)
                            return (
                              <div style={{ fontSize: '11px', color: '#4338ca', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>📦 Pertenece a:</span>
                                <strong
                                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                  onClick={() => {
                                    setFiltroPadreId(String(item.PadreID))
                                    setFiltroNivel('TODOS')
                                  }}
                                  title="Clic para ver todos los componentes de este ensamble"
                                >
                                  {padreObj?.Nombre || `Ensamble #${item.PadreID}`}
                                </strong>
                              </div>
                            )
                          })()}

                          {/* SI ES UN ENSAMBLE CON COMPONENTES HIJOS */}
                          {tieneHijos && (() => {
                            const totalHijos = disenos.filter((h) => h.PadreID === item.ID).length
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFiltroPadreId(String(item.ID))
                                    setFiltroNivel('TODOS')
                                  }}
                                  className="pro-badge"
                                  style={{
                                    backgroundColor: '#eff6ff',
                                    color: '#0071e3',
                                    border: '1px solid #bfdbfe',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    padding: '2px 7px'
                                  }}
                                  title="Filtrar el tablero para ver sus componentes"
                                >
                                  🧩 Ver sus {totalHijos} componentes →
                                </button>
                              </div>
                            )
                          })()}
                        </div>

                        {/* BARRA DE PROGRESO */}
                        <div style={{ width: '100%', backgroundColor: '#f1f5f9', height: '6px', borderRadius: '99px', overflow: 'hidden' }}>
                          <div style={{ width: `${porcentaje}%`, backgroundColor: col.color, height: '100%', transition: 'width 0.3s ease' }} />
                        </div>

                        {/* CONTADOR DE PIEZAS */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                          <span className="pro-mono" style={{ fontWeight: 700, color: '#1d1d1f' }}>
                            {listaTotal} / {reqUnitaria} u. listas
                          </span>
                          {faltantes > 0 ? (
                            <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600 }}>
                              Faltan {faltantes} u.
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>
                              ✓ Meta completa
                            </span>
                          )}
                        </div>

                        {/* ÚLTIMO CONTEO / SALIDA REGISTRADA */}
                        {ultimoRegistro && (
                          <div style={{ fontSize: '10.5px', backgroundColor: '#f8fafc', padding: '4px 7px', borderRadius: '6px', color: '#475569', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span>🏷️</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${ultimoRegistro.origen}: ${ultimoRegistro.notas || ''}`}>
                              {ultimoRegistro.origen} ({ultimoRegistro.cantidadSumada > 0 ? `+${ultimoRegistro.cantidadSumada}` : ultimoRegistro.cantidadSumada} u.)
                            </span>
                          </div>
                        )}

                        {/* FECHA COMPROMISO SI TIENE */}
                        {fechaItem && (
                          <div style={{ fontSize: '11px', color: '#0071e3', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>📅 Entrega:</span>
                            <span className="pro-mono">{fechaItem}</span>
                          </div>
                        )}

                        {/* ACCIONES DE LA TARJETA */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', paddingTop: '6px', borderTop: '1px solid #f1f5f9', marginTop: '2px' }}>
                          {/* BOTÓN PRINCIPAL: REGISTRAR CONTEO */}
                          {puedeEditar ? (
                            <button
                              type="button"
                              onClick={() => abrirModalConteo(item)}
                              className="pro-btn pro-btn-sm"
                              style={{
                                padding: '4px 9px',
                                fontSize: '11.5px',
                                backgroundColor: '#0071e3',
                                color: '#ffffff',
                                border: 'none',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                              title="Registrar conteo de piezas o sumar salida de almacén"
                            >
                              <span>🔢</span>
                              <span>Conteo / Almacén</span>
                            </button>
                          ) : <div />}

                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {item.UrlGLB && (
                              <button
                                type="button"
                                onClick={() => setItemFlotante3D(item)}
                                className="pro-btn pro-btn-secondary pro-btn-sm"
                                style={{ padding: '3px 7px', fontSize: '11px' }}
                                title="Inspeccionar en 3D"
                              >
                                🧊 3D
                              </button>
                            )}

                            {item.UrlPDF && (
                              <button
                                type="button"
                                onClick={() => setPdfPrevisualizando({ url: item.UrlPDF, nombre: item.Nombre })}
                                className="pro-btn pro-btn-secondary pro-btn-sm"
                                style={{ padding: '3px 7px', fontSize: '11px' }}
                                title="Ver Plano PDF"
                              >
                                📄
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setModalFechaItem(item)
                                setFechaTemporal(fechaItem || '')
                              }}
                              className="pro-btn pro-btn-secondary pro-btn-sm"
                              style={{ padding: '3px 6px', fontSize: '11px' }}
                              title="Asignar fecha de entrega"
                            >
                              📅
                            </button>

                            {puedeEditar && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => abrirModalEditarTarea(item)}
                                  className="pro-btn pro-btn-secondary pro-btn-sm"
                                  style={{ padding: '3px 6px', fontSize: '11px' }}
                                  title="Editar tarea / pieza"
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setItemParaEliminar(item)}
                                  className="pro-btn pro-btn-secondary pro-btn-sm"
                                  style={{ padding: '3px 6px', fontSize: '11px', color: '#dc2626' }}
                                  title="Eliminar tarea"
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
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          VISTA 2: LISTA DE SALIDAS DE ALMACÉN VINCULABLES
      ========================================================================= */}
      {vistaActiva === 'salidas' && (
        <div className="pro-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border-light)', paddingBottom: '14px' }}>
            <div>
              <h3 style={{ fontSize: '16px', margin: 0, fontWeight: 700 }}>
                📦 Salidas de Almacén Registradas para {proyectoFiltro ? `el Proyecto "${proyectoFiltro}"` : 'Todos los Proyectos'}
              </h3>
              <span style={{ fontSize: '12px', color: '#86868b' }}>
                Artículos, refacciones y materiales despachados en almacén que puedes sumar directamente al conteo de tus tareas
              </span>
            </div>

            <button
              type="button"
              onClick={() => setVistaActiva('kanban')}
              className="pro-btn pro-btn-secondary pro-btn-sm"
            >
              ← Volver al Tablero Kanban
            </button>
          </div>

          {salidasProyecto.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#86868b' }}>
              <span style={{ fontSize: '36px', display: 'block', marginBottom: '10px' }}>📦</span>
              <strong style={{ fontSize: '15px', color: '#1d1d1f' }}>
                No hay salidas de almacén registradas para este proyecto
              </strong>
              <p style={{ fontSize: '12.5px', maxWidth: '440px', margin: '6px auto 0 auto' }}>
                Cuando en el módulo de Almacén se entregue material con destino a este proyecto, aparecerá aquí automáticamente para sumarlo al conteo del Kanban.
              </p>
            </div>
          ) : (
            <div className="pro-table-container">
              <table className="pro-table">
                <thead>
                  <tr>
                    <th>Fecha / Folio</th>
                    <th>Artículo Despachado</th>
                    <th style={{ textAlign: 'center' }}>Cantidad</th>
                    <th>Receptor (RH)</th>
                    <th>Autorizó Almacén</th>
                    <th>Observaciones</th>
                    <th style={{ textAlign: 'right' }}>Acciones para Kanban</th>
                  </tr>
                </thead>
                <tbody>
                  {salidasProyecto.map((salida, idx) => (
                    <tr key={salida.MovimientoID || idx}>
                      <td>
                        <div className="pro-mono" style={{ fontSize: '12px', fontWeight: 700 }}>
                          {salida.FechaMovimiento ? new Date(salida.FechaMovimiento).toLocaleDateString('es-MX') : 'Reciente'}
                        </div>
                        <span style={{ fontSize: '10.5px', color: '#86868b' }}>
                          {salida.FolioGrupo ? `Kit: ${salida.FolioGrupo}` : `Folio #${salida.MovimientoID || '-'}`}
                        </span>
                      </td>

                      <td>
                        <strong style={{ fontSize: '13.5px', color: '#1d1d1f' }}>
                          {salida.NombreProducto}
                        </strong>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {salida.TipoMovimiento === 'Salida Consumo' ? '📤 Salida Definitiva' : '🛠️ Préstamo'}
                        </div>
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <span className="pro-mono" style={{ fontSize: '14px', fontWeight: 800, color: '#0071e3' }}>
                          {salida.Cantidad} u.
                        </span>
                      </td>

                      <td>
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          👤 {salida.NombreEmpleado || 'Personal de Planta'}
                        </span>
                      </td>

                      <td>
                        <span className="pro-mono" style={{ fontSize: '11.5px', color: '#515154' }}>
                          {salida.UsuarioERP || 'Almacén'}
                        </span>
                      </td>

                      <td style={{ fontSize: '11.5px', color: '#515154', maxWidth: '200px' }}>
                        {salida.Notas || 'Sin notas adicionales'}
                      </td>

                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {puedeEditar && (
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => abrirModalVincularSalida(salida)}
                              className="pro-btn pro-btn-primary pro-btn-sm"
                              title="Sumar la cantidad de esta salida a una pieza o tarea existente en el Kanban"
                            >
                              ➕ Sumar a Pieza
                            </button>

                            <button
                              type="button"
                              onClick={() => convertirSalidaEnTarjetaKanban(salida)}
                              disabled={guardando}
                              className="pro-btn pro-btn-secondary pro-btn-sm"
                              title="Crear una tarjeta en Kanban para monitorear esta pieza de almacén"
                            >
                              📋 Crear Tarjeta
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          VISTA 3: CALENDARIO DE ENTREGAS
      ========================================================================= */}
      {vistaActiva === 'calendario' && (
        <div className="pro-card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <strong style={{ fontSize: '16px' }}>
              📅 {mesActual.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase()}
            </strong>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setMesActual(new Date(mesActual.getFullYear(), mesActual.getMonth() - 1, 1))}
                className="pro-btn pro-btn-secondary pro-btn-sm"
              >
                « Anterior
              </button>
              <button
                type="button"
                onClick={() => {
                  const hoy = new Date()
                  setMesActual(new Date(hoy.getFullYear(), hoy.getMonth(), 1))
                }}
                className="pro-btn pro-btn-secondary pro-btn-sm"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => setMesActual(new Date(mesActual.getFullYear(), mesActual.getMonth() + 1, 1))}
                className="pro-btn pro-btn-secondary pro-btn-sm"
              >
                Siguiente »
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d, i) => (
              <div key={i} style={{ textAlign: 'center', fontWeight: 700, fontSize: '11px', color: '#86868b', padding: '6px' }}>
                {d}
              </div>
            ))}

            {construirDiasCalendario().map((celda, idx) => {
              if (!celda) {
                return <div key={`empty-${idx}`} style={{ minHeight: '100px', backgroundColor: '#f8fafc', borderRadius: '10px', opacity: 0.4 }} />
              }

              const entregablesDia = itemsFiltrados.filter((item) => fechasCompromiso[item.ID] === celda.fechaISO)
              const esHoy = celda.fechaISO === new Date().toISOString().split('T')[0]

              return (
                <div
                  key={celda.fechaISO}
                  style={{
                    minHeight: '100px',
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
                    {esHoy && <span style={{ fontSize: '10px', color: '#0071e3', fontWeight: 800 }}>HOY</span>}
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
        </div>
      )}

      {/* =========================================================================
          MODAL 1: REGISTRO DE CONTEO Y VINCULACIÓN CON SALIDAS DE ALMACÉN
      ========================================================================= */}
      {modalConteoItem &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalConteoItem(null)}>
            <div
              className="pro-modal-window"
              style={{ maxWidth: '820px', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pro-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '22px' }}>🔢</span>
                  <div>
                    <h3 style={{ fontSize: '16px', margin: 0, fontWeight: 700 }}>
                      Registro de Conteo y Avance: {modalConteoItem.Nombre}
                    </h3>
                    <span style={{ fontSize: '12px', color: '#86868b' }}>
                      Proyecto: <strong>{modalConteoItem.Proyecto || 'General'}</strong> · Sumar piezas terminadas o vincular salida de almacén
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => setModalConteoItem(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>

              <div className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {/* ESTADO ACTUAL DEL ÍTEM */}
                {(() => {
                  const { reqUnitaria, listaTotal, porcentaje, faltantes, bitacora } = obtenerMetricasItem(modalConteoItem)
                  return (
                    <>
                      <div style={{ backgroundColor: '#f8fafc', padding: '14px 18px', borderRadius: '12px', border: '1px solid var(--border-light)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                        <div>
                          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>Meta Requerida</span>
                          <div className="pro-mono" style={{ fontSize: '18px', fontWeight: 800, color: '#1d1d1f' }}>
                            {reqUnitaria} u.
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>Llevamos Listas</span>
                          <div className="pro-mono" style={{ fontSize: '18px', fontWeight: 800, color: '#0071e3' }}>
                            {listaTotal} u.
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>Faltan por Concluir</span>
                          <div className="pro-mono" style={{ fontSize: '18px', fontWeight: 800, color: faltantes > 0 ? '#dc2626' : '#059669' }}>
                            {faltantes} u.
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>% Terminado</span>
                          <div className="pro-mono" style={{ fontSize: '18px', fontWeight: 800, color: porcentaje === 100 ? '#059669' : '#0071e3' }}>
                            {porcentaje}%
                          </div>
                        </div>
                      </div>

                      {/* SECCIÓN A: SALIDAS DE ALMACÉN VINCULABLES */}
                      <div style={{ border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px', backgroundColor: '#eff6ff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '18px' }}>📦</span>
                            <strong style={{ fontSize: '14px', color: '#1e40af' }}>
                              Vincular Salidas de Almacén de este Proyecto ({salidasProyecto.length} disponibles)
                            </strong>
                          </div>
                        </div>

                        {salidasProyecto.length === 0 ? (
                          <div style={{ fontSize: '12px', color: '#64748b', backgroundColor: '#ffffff', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                            No hay salidas registradas en almacén con este proyecto aún. Si se despachó material, puedes sumarlo directamente con el conteo manual abajo.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                            {salidasProyecto.map((sal) => {
                              const fechaFormateada = sal.FechaMovimiento ? new Date(sal.FechaMovimiento).toLocaleDateString('es-MX') : ''
                              const esSeleccionado = salidaSeleccionadaParaConteo?.MovimientoID === sal.MovimientoID

                              return (
                                <div
                                  key={sal.MovimientoID}
                                  style={{
                                    backgroundColor: esSeleccionado ? '#ffffff' : 'rgba(255,255,255,0.85)',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${esSeleccionado ? '#0071e3' : '#cbd5e1'}`,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '10px'
                                  }}
                                >
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <strong style={{ fontSize: '13px', color: '#1d1d1f' }}>{sal.NombreProducto}</strong>
                                      <span className="pro-badge pro-mono" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: 700 }}>
                                        {sal.Cantidad} u.
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                                      Salida: {fechaFormateada} · Recibió: <strong>{sal.NombreEmpleado || 'Taller'}</strong> · {sal.Notas ? `"${sal.Notas}"` : ''}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => imputarSalidaAlmacenAConteo(sal)}
                                    disabled={guardando}
                                    className="pro-btn pro-btn-primary pro-btn-sm"
                                    style={{ fontSize: '11px', padding: '5px 10px', whiteSpace: 'nowrap' }}
                                  >
                                    ➕ Sumar Salida (+{sal.Cantidad} u.)
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* SECCIÓN B: REGISTRO MANUAL DE CONTEO EN TALLER */}
                      <form onSubmit={aplicarConteoManual} style={{ border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '18px' }}>⚙️</span>
                          <strong style={{ fontSize: '14px', color: '#1d1d1f' }}>
                            Registro Manual de Conteo en Taller / Producción
                          </strong>
                        </div>

                        {/* BOTONES RÁPIDOS */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>Acceso rápido:</span>
                          {[1, 2, 5, 10].map((num) => (
                            <button
                              key={num}
                              type="button"
                              onClick={() => setCantidadSumar(String(num))}
                              className="pro-btn pro-btn-secondary pro-btn-sm pro-mono"
                              style={{ padding: '3px 8px' }}
                            >
                              +{num}
                            </button>
                          ))}
                          {faltantes > 0 && (
                            <button
                              type="button"
                              onClick={() => setCantidadSumar(String(faltantes))}
                              className="pro-btn pro-btn-secondary pro-btn-sm pro-mono"
                              style={{ padding: '3px 8px', color: '#059669', borderColor: '#86efac' }}
                            >
                              Completar Todo (+{faltantes} u.)
                            </button>
                          )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px' }}>
                          <div>
                            <label className="pro-label">Cantidad a Sumar *</label>
                            <input
                              type="number"
                              min="1"
                              value={cantidadSumar}
                              onChange={(e) => setCantidadSumar(e.target.value)}
                              required
                              className="pro-input pro-mono"
                              style={{ fontWeight: 700 }}
                            />
                          </div>

                          <div>
                            <label className="pro-label">Observaciones / Notas del Conteo</label>
                            <input
                              type="text"
                              placeholder="Ej. Turno matutino, corte terminado, lote verificado..."
                              value={notasConteo}
                              onChange={(e) => setNotasConteo(e.target.value)}
                              className="pro-input"
                            />
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                          <button
                            type="submit"
                            disabled={guardando}
                            className="pro-btn pro-btn-success"
                          >
                            {guardando ? 'Guardando en Azure SQL...' : `💾 Sumar +${cantidadSumar} u. al Conteo`}
                          </button>
                        </div>
                      </form>

                      {/* SECCIÓN C: BITÁCORA HISTÓRICA DE CONTEOS */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <strong style={{ fontSize: '13px', color: '#515154' }}>
                            📜 Bitácora de Movimientos y Conteos Registrados ({bitacora.length})
                          </strong>
                        </div>

                        {bitacora.length === 0 ? (
                          <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                            No hay registros previos de conteo para esta pieza.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                            {bitacora.slice().reverse().map((reg, idx) => (
                              <div
                                key={idx}
                                style={{
                                  fontSize: '11.5px',
                                  padding: '7px 10px',
                                  backgroundColor: '#f8fafc',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-light)',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 600, color: '#1d1d1f' }}>
                                    {reg.origen} · {reg.notas || 'Sin notas'}
                                  </div>
                                  <span style={{ fontSize: '10.5px', color: '#86868b' }}>
                                    {reg.fecha ? new Date(reg.fecha).toLocaleString('es-MX') : ''} · Registrado por: <strong>{reg.usuario || 'Operador'}</strong>
                                  </span>
                                </div>
                                <span className="pro-mono" style={{ fontWeight: 800, color: '#0071e3', fontSize: '12px' }}>
                                  +{reg.cantidadSumada} u.
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>

              <div className="pro-modal-footer">
                <button type="button" onClick={() => setModalConteoItem(null)} className="pro-btn pro-btn-secondary">
                  Cerrar
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 2: VINCULACIÓN DIRECTA DE SALIDA DE ALMACÉN HACIA TAREA EXISTENTE
      ========================================================================= */}
      {modalVincularSalida &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalVincularSalida(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <div>
                  <h3 style={{ fontSize: '16px', margin: 0, fontWeight: 700 }}>
                    Sumar Salida de Almacén al Conteo de una Pieza
                  </h3>
                  <span style={{ fontSize: '12px', color: '#86868b' }}>
                    Salida: <strong>{modalVincularSalida.NombreProducto}</strong> ({modalVincularSalida.Cantidad} u. despachadas)
                  </span>
                </div>
                <button type="button" onClick={() => setModalVincularSalida(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>

              <form onSubmit={ejecutarVinculacionSalida} className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label className="pro-label">Selecciona la Tarea / Pieza Destino en el Kanban *</label>
                  <select
                    value={tareaDestinoId}
                    onChange={(e) => setTareaDestinoId(e.target.value)}
                    required
                    className="pro-select"
                  >
                    <option value="">-- Selecciona qué ítem recibe este material --</option>
                    {itemsFiltrados.map((it) => {
                      const m = obtenerMetricasItem(it)
                      return (
                        <option key={it.ID} value={it.ID}>
                          [{it.TipoNivel}] {it.Nombre} — Actual: {m.listaTotal}/{m.reqUnitaria} u. ({m.porcentaje}%)
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div>
                  <label className="pro-label">Cantidad a Imputar al Conteo *</label>
                  <input
                    type="number"
                    min="1"
                    max={modalVincularSalida.Cantidad}
                    value={cantidadImputarSalida}
                    onChange={(e) => setCantidadImputarSalida(e.target.value)}
                    required
                    className="pro-input pro-mono"
                  />
                  <span style={{ fontSize: '11px', color: '#86868b' }}>
                    Disponible en la salida: {modalVincularSalida.Cantidad} u.
                  </span>
                </div>

                <div className="pro-modal-footer" style={{ padding: '12px 0 0 0' }}>
                  <button type="button" onClick={() => setModalVincularSalida(null)} className="pro-btn pro-btn-secondary">
                    Cancelar
                  </button>
                  <button type="submit" disabled={guardando} className="pro-btn pro-btn-primary">
                    {guardando ? 'Guardando...' : '➕ Aplicar al Conteo de la Pieza'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 3: ALTA O EDICIÓN DE TAREA / PIEZA
      ========================================================================= */}
      {modalTareaAbierto &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalTareaAbierto(false)}>
            <div className="pro-modal-window" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <div>
                  <h3 style={{ fontSize: '16px', margin: 0, fontWeight: 700 }}>
                    {tareaEditando ? `Modificar: ${tareaEditando.Nombre}` : 'Nueva Tarea / Pieza para el Proyecto'}
                  </h3>
                  <span style={{ fontSize: '12px', color: '#86868b' }}>
                    {tareaEditando ? `ID #${tareaEditando.ID}` : 'Crea cosas por hacer y da seguimiento a su progreso en Kanban'}
                  </span>
                </div>
                <button type="button" onClick={() => setModalTareaAbierto(false)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>

              <form onSubmit={guardarTareaModal} className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label className="pro-label">Proyecto *</label>
                  <select
                    value={proyectoForm}
                    onChange={(e) => setProyectoForm(e.target.value)}
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
                  <label className="pro-label">Nombre de la Pieza o Actividad *</label>
                  <input
                    type="text"
                    value={nombreForm}
                    onChange={(e) => setNombreForm(e.target.value)}
                    required
                    placeholder="Ej. Mecanizado de buje, Ensamble de soporte, Pintura..."
                    className="pro-input"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="pro-label">Tipo / Clasificación *</label>
                    <select
                      value={tipoNivelForm}
                      onChange={(e) => {
                        setTipoNivelForm(e.target.value)
                        if (e.target.value === 'Ensamble' || e.target.value === 'Tarea') setPadreIDForm('')
                      }}
                      className="pro-select"
                    >
                      <option value="Pieza">⚙️ Pieza Individual</option>
                      <option value="Subensamble">🧩 Subensamble</option>
                      <option value="Ensamble">📦 Ensamble General</option>
                      <option value="Tarea">📝 Tarea de Proceso</option>
                    </select>
                  </div>

                  <div>
                    <label className="pro-label">Cantidad Requerida (Meta) *</label>
                    <input
                      type="number"
                      min="1"
                      value={cantidadRequeridaForm}
                      onChange={(e) => setCantidadRequeridaForm(e.target.value)}
                      required
                      className="pro-input pro-mono"
                    />
                  </div>
                </div>

                {/* SELECTOR DE ENSAMBLE PADRE PARA PIEZA O SUBENSAMBLE */}
                {(tipoNivelForm === 'Subensamble' || tipoNivelForm === 'Pieza') && (
                  <div>
                    <label className="pro-label">
                      📦 Ensamble Padre / Conjunto (Estructura BOM)
                    </label>
                    <select
                      value={padreIDForm}
                      onChange={(e) => setPadreIDForm(e.target.value)}
                      className="pro-select"
                    >
                      <option value="">-- Sin Ensamble Padre (Componente Independiente) --</option>
                      {padresDisponibles.map((p) => (
                        <option key={p.ID} value={p.ID}>
                          [{p.TipoNivel}] {p.Nombre} ({p.Proyecto})
                        </option>
                      ))}
                    </select>
                    <span style={{ fontSize: '11px', color: '#86868b' }}>
                      {padresDisponibles.length === 0
                        ? '💡 No hay ensambles creados aún en este proyecto. Puedes dejarlo independiente o crear primero el ensamble padre.'
                        : 'Vincula esta pieza a su ensamble para que el avance del conjunto se calcule automáticamente.'}
                    </span>
                  </div>
                )}

                <div>
                  <label className="pro-label">Cantidad Inicial Concluida</label>
                  <input
                    type="number"
                    min="0"
                    max={cantidadRequeridaForm}
                    value={cantidadListaForm}
                    onChange={(e) => setCantidadListaForm(e.target.value)}
                    className="pro-input pro-mono"
                  />
                  <span style={{ fontSize: '11px', color: '#86868b' }}>
                    Unidades ya fabricadas o listas al momento de crear la tarjeta (default: 0)
                  </span>
                </div>

                <div className="pro-modal-footer" style={{ padding: '12px 0 0 0' }}>
                  <button type="button" onClick={() => setModalTareaAbierto(false)} className="pro-btn pro-btn-secondary">
                    Cancelar
                  </button>
                  <button type="submit" disabled={guardando} className="pro-btn pro-btn-primary">
                    {guardando ? 'Guardando...' : (tareaEditando ? '💾 Actualizar Tarea' : '➕ Crear Tarjeta en Kanban')}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 4: ASIGNAR FECHA DE ENTREGA
      ========================================================================= */}
      {modalFechaItem &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalFechaItem(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0 }}>📅 Programar Entrega: {modalFechaItem.Nombre}</h3>
                <button type="button" onClick={() => setModalFechaItem(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>
              <div className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label className="pro-label">Fecha Compromiso de Entrega</label>
                <input
                  type="date"
                  value={fechaTemporal}
                  onChange={(e) => setFechaTemporal(e.target.value)}
                  className="pro-input"
                />
              </div>
              <div className="pro-modal-footer">
                {fechasCompromiso[modalFechaItem.ID] && (
                  <button
                    type="button"
                    onClick={() => {
                      const actualizadas = { ...fechasCompromiso }
                      delete actualizadas[modalFechaItem.ID]
                      setFechasCompromiso(actualizadas)
                      setModalFechaItem(null)
                      notificar('Fecha removida')
                    }}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                    style={{ color: '#dc2626' }}
                  >
                    Quitar Fecha
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (fechaTemporal) {
                      setFechasCompromiso((prev) => ({ ...prev, [modalFechaItem.ID]: fechaTemporal }))
                      notificar('Fecha de entrega programada')
                    }
                    setModalFechaItem(null)
                  }}
                  className="pro-btn pro-btn-primary pro-btn-sm"
                >
                  Guardar Fecha
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 5: CONFIRMAR ELIMINACIÓN
      ========================================================================= */}
      {itemParaEliminar &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setItemParaEliminar(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '15px', margin: 0, color: '#dc2626' }}>🗑️ Confirmar Eliminación</h3>
                <button type="button" onClick={() => setItemParaEliminar(null)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>
              <div className="pro-modal-body">
                ¿Estás seguro de que deseas eliminar permanentemente <strong>&ldquo;{itemParaEliminar.Nombre}&rdquo;</strong> del tablero Kanban?
              </div>
              <div className="pro-modal-footer">
                <button type="button" onClick={() => setItemParaEliminar(null)} className="pro-btn pro-btn-secondary">
                  Cancelar
                </button>
                <button type="button" onClick={confirmarEliminarItem} disabled={guardando} className="pro-btn pro-btn-danger">
                  {guardando ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 6: VISOR 3D FLOTANTE
      ========================================================================= */}
      {itemFlotante3D &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setItemFlotante3D(null)}>
            <div
              className="pro-modal-window"
              style={{ maxWidth: '960px', height: '88vh', display: 'flex', flexDirection: 'column', padding: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '12px 18px', backgroundColor: '#1e293b', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🧊</span>
                  <strong style={{ fontSize: '14px' }}>Inspección 3D: {itemFlotante3D.Nombre}</strong>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {itemFlotante3D.UrlPDF && (
                    <button
                      type="button"
                      onClick={() => setPdfPrevisualizando({ url: itemFlotante3D.UrlPDF, nombre: itemFlotante3D.Nombre })}
                      className="pro-btn pro-btn-secondary pro-btn-sm"
                      style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: '#ffffff', border: 'none' }}
                    >
                      📄 Ver Plano PDF
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setItemFlotante3D(null)}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                    style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: '#ffffff', border: 'none' }}
                  >
                    ✕ Cerrar
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, position: 'relative' }}>
                <GlbViewer
                  modelUrl={itemFlotante3D.UrlGLB}
                  componenteInfo={itemFlotante3D}
                  mostrarHUD={true}
                />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 7: VISOR DE PLANO TÉCNICO PDF
      ========================================================================= */}
      {pdfPrevisualizando &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setPdfPrevisualizando(null)}>
            <div
              className="pro-modal-window"
              style={{ maxWidth: '960px', height: '88vh', display: 'flex', flexDirection: 'column', padding: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '12px 18px', backgroundColor: '#0f172a', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📄</span>
                  <strong style={{ fontSize: '14px' }}>Plano Técnico: {pdfPrevisualizando.nombre}</strong>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a
                    href={pdfPrevisualizando.url}
                    target="_blank"
                    rel="noreferrer"
                    className="pro-btn pro-btn-primary pro-btn-sm"
                  >
                    Abrir en pestaña nueva ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => setPdfPrevisualizando(null)}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                    style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: '#ffffff', border: 'none' }}
                  >
                    ✕ Cerrar
                  </button>
                </div>
              </div>

              <iframe
                src={pdfPrevisualizando.url}
                title="Plano PDF"
                style={{ width: '100%', flex: 1, border: 'none' }}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
