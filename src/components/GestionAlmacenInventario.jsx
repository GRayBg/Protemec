import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import GestionAlmacen3D from './GestionAlmacen3D'

export default function GestionAlmacenInventario({
  compras = [],
  proyectos = [],
  personalRH = [],
  usuarioActual = null,
  API_URL,
  recargarDatos,
  mostrarToast,
  irAlVisor3D,
  puedeEditar = true,
  syncTrigger = 0
}) {
  // Vista inicial: 'hub' (Centro de Mando visual) | 'inventario' | 'grupo' | 'prestamos' | 'recepcion' | 'kardex'
  const [pestanaInterna, setPestanaInterna] = useState('hub')
  const [inventario, setInventario] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [procesando, setProcesando] = useState(false)

  // Nombre del operador con sesión iniciada en el ERP
  const etiquetaOperadorActivo = useMemo(() => {
    if (!usuarioActual) return 'Operador Almacén'
    const nombre = usuarioActual.nombre || 'Usuario'
    const user = usuarioActual.usuario || usuarioActual.email || ''
    return user ? `${nombre} (${user})` : nombre
  }, [usuarioActual])

  // Filtros dinámicos de Existencias
  const [busquedaInv, setBusquedaInv] = useState('')
  const [filtroStockInv, setFiltroStockInv] = useState('TODOS') // 'TODOS' | 'DISPONIBLE' | 'BAJO' | 'AGOTADO'
  const [filtroUbicacionInv, setFiltroUbicacionInv] = useState('TODAS')

  // Filtros dinámicos de Kardex
  const [busquedaKardex, setBusquedaKardex] = useState('')
  const [filtroTipoKardex, setFiltroTipoKardex] = useState('TODOS')
  const [filtroPeriodoKardex, setFiltroPeriodoKardex] = useState('TODOS') // 'TODOS' | 'HOY' | 'SEMANA' | 'MES'

  // Ventana Flotante 3D para ubicar una pieza sin salir del inventario
  const [itemFlotante3D, setItemFlotante3D] = useState(null)

  // Modal de Entrada Manual / Suma de Stock / Recepción
  const [modalEntrada, setModalEntrada] = useState(false)
  const [modoEntrada, setModoEntrada] = useState('existente') // 'existente' | 'nuevo'
  const [idItemEntrada, setIdItemEntrada] = useState('')
  const [nombreNuevoProd, setNombreNuevoProd] = useState('')
  const [ubicacion3DInput, setUbicacion3DInput] = useState('Pieza1')
  const [cantidadEntrada, setCantidadEntrada] = useState('1')
  const [notasEntrada, setNotasEntrada] = useState('')
  const [compraSeleccionada, setCompraSeleccionada] = useState(null)

  // Modal de Salida Individual o Préstamo
  const [modalSalida, setModalSalida] = useState(false)
  const [itemParaSalida, setItemParaSalida] = useState(null)
  const [tipoSalida, setTipoSalida] = useState('Prestamo Herramienta')
  const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState('')
  const [cantidadSalida, setCantidadSalida] = useState('1')
  const [proyectoDestino, setProyectoDestino] = useState('')
  const [notasSalida, setNotasSalida] = useState('')

  // Estado para Envío en Grupo a Sitio (Kits de Herramienta / Material)
  const [empGrupoId, setEmpGrupoId] = useState('')
  const [proyectoGrupo, setProyectoGrupo] = useState('')
  const [sitioTrabajoGrupo, setSitioTrabajoGrupo] = useState('')
  const [notasGrupo, setNotasGrupo] = useState('')
  const [busquedaSelectorGrupo, setBusquedaSelectorGrupo] = useState('')
  const [carritoGrupo, setCarritoGrupo] = useState([])

  const cargarAlmacen = useCallback(async () => {
    try {
      const ts = Date.now()
      const [resInv, resMov] = await Promise.all([
        fetch(`${API_URL}/api/inventario?t=${ts}`),
        fetch(`${API_URL}/api/inventario/movimientos?t=${ts}`)
      ])
      if (resInv.ok) setInventario(await resInv.json())
      if (resMov.ok) setMovimientos(await resMov.json())
    } catch {
      // Silencioso
    }
  }, [API_URL])

  // Recarga al iniciar y también cada vez que se presiona el botón "Sincronizar" en el Header
  useEffect(() => {
    const controller = new AbortController()
    const ts = Date.now()

    Promise.all([
      fetch(`${API_URL}/api/inventario?t=${ts}`, { signal: controller.signal }),
      fetch(`${API_URL}/api/inventario/movimientos?t=${ts}`, { signal: controller.signal })
    ])
      .then(async ([resInv, resMov]) => {
        if (resInv.ok) setInventario(await resInv.json())
        if (resMov.ok) setMovimientos(await resMov.json())
      })
      .catch(() => {})

    return () => controller.abort()
  }, [API_URL, syncTrigger])

  // Solo mostrar personal ACTIVO de RH
  const personalActivo = useMemo(
    () => personalRH.filter((p) => p.Activo === true || p.Activo === 1),
    [personalRH]
  )

  const empGrupoIdEfectivo =
    empGrupoId || (personalActivo[0] ? String(personalActivo[0].EmpleadoID) : '')

  const comprasPendientesRecepcion = useMemo(
    () =>
      compras.filter(
        (c) =>
          (c.Estatus || c.estatus) === 'Comprado' &&
          !String(c.EstatusAlmacen || c.estatusAlmacen || '').toLowerCase().includes('recibido')
      ),
    [compras]
  )

  const prestamosActivos = useMemo(
    () => movimientos.filter((m) => m.EstatusPrestamo === 'Prestado'),
    [movimientos]
  )

  // Agrupación de préstamos activos por FolioGrupo (Kits en Sitio)
  const kitsEnSitioActivos = useMemo(() => {
    const mapa = {}
    prestamosActivos.forEach((m) => {
      const clave = m.FolioGrupo || `IND-${m.MovimientoID}`
      if (!mapa[clave]) {
        mapa[clave] = {
          folio: m.FolioGrupo || null,
          esGrupo: Boolean(m.FolioGrupo),
          empleado: m.NombreEmpleado || 'Colaborador',
          departamento: m.Departamento || '',
          proyecto: m.Proyecto || 'Sitio Externo',
          fecha: m.FechaMovimiento,
          operadorERP: m.UsuarioERP || etiquetaOperadorActivo,
          partidas: []
        }
      }
      mapa[clave].partidas.push(m)
    })
    return Object.values(mapa)
  }, [prestamosActivos, etiquetaOperadorActivo])

  // =========================================================================
  // ANALÍTICA PREDICTIVA DE ALMACÉN (TOP SALIDAS Y ALERTAS DE STOCK)
  // =========================================================================
  const analiticaAlmacen = useMemo(() => {
    const conteoSalidas = {}
    let totalEntradas = 0
    let totalSalidas = 0
    let totalPrestamos = 0

    movimientos.forEach((m) => {
      const cant = Number(m.Cantidad) || 0
      const tipo = String(m.TipoMovimiento || '')
      if (tipo.includes('Entrada') || tipo.includes('Recepcion')) {
        totalEntradas += cant
      } else {
        if (tipo === 'Prestamo Herramienta') totalPrestamos += cant
        else totalSalidas += cant

        const prod = m.NombreProducto || 'Artículo'
        if (!conteoSalidas[prod]) {
          conteoSalidas[prod] = { nombre: prod, unidades: 0, eventos: 0 }
        }
        conteoSalidas[prod].unidades += cant
        conteoSalidas[prod].eventos += 1
      }
    })

    const topMasSalidas = Object.values(conteoSalidas)
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 6)

    const articulosCriticos = [...inventario]
      .filter((i) => (Number(i.CantidadStock) || 0) <= 5)
      .sort((a, b) => (Number(a.CantidadStock) || 0) - (Number(b.CantidadStock) || 0))
      .slice(0, 6)

    return {
      topMasSalidas,
      maxSalidaUnidades: Math.max(...topMasSalidas.map((x) => x.unidades), 1),
      articulosCriticos,
      totalEntradas,
      totalSalidas,
      totalPrestamos
    }
  }, [movimientos, inventario])

  // Ubicaciones 3D únicas para filtro rápido
  const ubicaciones3DUnicas = useMemo(
    () => [...new Set(inventario.map((i) => i.Ubicacion3D).filter(Boolean))],
    [inventario]
  )

  // Filtrado dinámico de Existencias
  const inventarioFiltrado = useMemo(() => {
    const q = busquedaInv.trim().toLowerCase()
    return inventario.filter((item) => {
      const stock = Number(item.CantidadStock) || 0
      if (filtroStockInv === 'DISPONIBLE' && stock <= 0) return false
      if (filtroStockInv === 'BAJO' && (stock <= 0 || stock > 5)) return false
      if (filtroStockInv === 'AGOTADO' && stock > 0) return false
      if (filtroUbicacionInv !== 'TODAS' && item.Ubicacion3D !== filtroUbicacionInv) return false

      if (q) {
        return (
          String(item.ID).includes(q) ||
          String(item.NombreProducto || '').toLowerCase().includes(q) ||
          String(item.Ubicacion3D || '').toLowerCase().includes(q) ||
          String(item.Estado || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [inventario, busquedaInv, filtroStockInv, filtroUbicacionInv])

  // Filtrado dinámico de Kardex
  const movimientosFiltrados = useMemo(() => {
    const q = busquedaKardex.trim().toLowerCase()
    const ahora = new Date()

    return movimientos.filter((m) => {
      if (filtroTipoKardex !== 'TODOS') {
        if (
          filtroTipoKardex === 'ENTRADAS' &&
          !String(m.TipoMovimiento).includes('Entrada') &&
          !String(m.TipoMovimiento).includes('Recepcion')
        )
          return false
        if (filtroTipoKardex === 'SALIDAS' && m.TipoMovimiento !== 'Salida Consumo') return false
        if (filtroTipoKardex === 'PRESTAMOS' && m.TipoMovimiento !== 'Prestamo Herramienta') return false
        if (filtroTipoKardex === 'GRUPO' && !m.FolioGrupo) return false
      }

      if (filtroPeriodoKardex !== 'TODOS' && m.FechaMovimiento) {
        const fMov = new Date(m.FechaMovimiento)
        const diffDias = (ahora - fMov) / (1000 * 60 * 60 * 24)
        if (filtroPeriodoKardex === 'HOY' && fMov.toDateString() !== ahora.toDateString()) return false
        if (filtroPeriodoKardex === 'SEMANA' && diffDias > 7) return false
        if (filtroPeriodoKardex === 'MES' && diffDias > 31) return false
      }

      if (q) {
        return (
          String(m.NombreProducto || '').toLowerCase().includes(q) ||
          String(m.NombreEmpleado || '').toLowerCase().includes(q) ||
          String(m.UsuarioERP || '').toLowerCase().includes(q) ||
          String(m.Proyecto || '').toLowerCase().includes(q) ||
          String(m.FolioGrupo || '').toLowerCase().includes(q) ||
          String(m.Notas || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [movimientos, busquedaKardex, filtroTipoKardex, filtroPeriodoKardex])

  // =========================================================================
  // FUNCIONES OPERATIVAS (ENTRADAS, SALIDAS Y ENVÍOS EN GRUPO)
  // =========================================================================
  const abrirModalEntradaManual = (itemPreseleccionado = null, desdeCompra = null) => {
    setCompraSeleccionada(desdeCompra)
    if (itemPreseleccionado) {
      setModoEntrada('existente')
      setIdItemEntrada(String(itemPreseleccionado.ID))
      setNombreNuevoProd(itemPreseleccionado.NombreProducto)
      setUbicacion3DInput(itemPreseleccionado.Ubicacion3D || 'Pieza1')
      setCantidadEntrada('1')
      setNotasEntrada('')
    } else if (desdeCompra) {
      const prodCompra = desdeCompra.Producto || desdeCompra.producto || ''
      const coincidencia = inventario.find(
        (i) => String(i.NombreProducto || '').toLowerCase() === prodCompra.toLowerCase()
      )
      if (coincidencia) {
        setModoEntrada('existente')
        setIdItemEntrada(String(coincidencia.ID))
        setUbicacion3DInput(coincidencia.Ubicacion3D || 'Pieza1')
      } else {
        setModoEntrada('nuevo')
        setNombreNuevoProd(prodCompra)
        setUbicacion3DInput('Pieza1')
      }
      setCantidadEntrada(String(desdeCompra.Cantidad || desdeCompra.cantidad || 1))
      setNotasEntrada(`Recepción de Orden #${desdeCompra.Numero} (${desdeCompra.Proveedor || ''})`)
    } else {
      setModoEntrada('existente')
      setIdItemEntrada(inventario[0]?.ID ? String(inventario[0].ID) : '')
      setNombreNuevoProd('')
      setUbicacion3DInput(inventario[0]?.Ubicacion3D || 'Pieza1')
      setCantidadEntrada('1')
      setNotasEntrada('')
    }
    setModalEntrada(true)
  }

  const guardarEntradaInventario = async (e) => {
    e.preventDefault()
    setProcesando(true)
    try {
      const payload = {
        compraID: compraSeleccionada ? compraSeleccionada.Numero : null,
        modo: modoEntrada,
        inventarioIDExistente: modoEntrada === 'existente' ? parseInt(idItemEntrada, 10) : null,
        nombreProducto: modoEntrada === 'nuevo' ? nombreNuevoProd.trim() : '',
        ubicacion3D: ubicacion3DInput.trim() || 'Pieza1',
        cantidad: parseInt(cantidadEntrada, 10) || 1,
        notas: notasEntrada.trim(),
        usuarioERP: etiquetaOperadorActivo
      }

      const res = await fetch(`${API_URL}/api/inventario/ingresar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Error al registrar entrada en almacén')

      if (mostrarToast) {
        mostrarToast(`Stock registrado por ${etiquetaOperadorActivo}`)
      }
      setModalEntrada(false)
      setCompraSeleccionada(null)
      await cargarAlmacen()
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setProcesando(false)
    }
  }

  const abrirModalSalidaItem = (item, tipoInicial = 'Prestamo Herramienta') => {
    setItemParaSalida(item)
    setTipoSalida(tipoInicial)
    setEmpleadoSeleccionado(personalActivo[0]?.EmpleadoID ? String(personalActivo[0].EmpleadoID) : '')
    setCantidadSalida('1')
    setProyectoDestino('')
    setNotasSalida('')
    setModalSalida(true)
  }

  const registrarSalidaOPrestamo = async (e) => {
    e.preventDefault()
    if (!itemParaSalida || !empleadoSeleccionado) return

    setProcesando(true)
    try {
      const res = await fetch(`${API_URL}/api/inventario/salida`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventarioID: itemParaSalida.ID,
          tipoMovimiento: tipoSalida,
          cantidad: parseInt(cantidadSalida, 10) || 1,
          empleadoID: parseInt(empleadoSeleccionado, 10),
          proyecto: proyectoDestino,
          notas: notasSalida,
          usuarioERP: etiquetaOperadorActivo
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar la salida')

      if (mostrarToast) mostrarToast(data.mensaje)
      setModalSalida(false)
      await cargarAlmacen()
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setProcesando(false)
    }
  }

  // Funciones para armar Kit / Salida en Grupo a Sitio
  const agregarItemAlCarritoGrupo = (itemInv) => {
    const stockDisp = Number(itemInv.CantidadStock) || 0
    if (stockDisp <= 0) {
      if (mostrarToast) mostrarToast('Este artículo no tiene stock disponible', 'alerta')
      return
    }
    setCarritoGrupo((prev) => {
      const yaExiste = prev.find((x) => x.inventarioID === itemInv.ID)
      if (yaExiste) {
        const nuevaCant = Math.min(yaExiste.cantidad + 1, stockDisp)
        return prev.map((x) => (x.inventarioID === itemInv.ID ? { ...x, cantidad: nuevaCant } : x))
      }
      return [
        ...prev,
        {
          inventarioID: itemInv.ID,
          nombreProducto: itemInv.NombreProducto,
          ubicacion3D: itemInv.Ubicacion3D || 'Pieza1',
          stockMax: stockDisp,
          cantidad: 1,
          tipoMovimiento: 'Prestamo Herramienta'
        }
      ]
    })
  }

  const actualizarItemCarrito = (idInv, campo, valor) => {
    setCarritoGrupo((prev) =>
      prev.map((item) => {
        if (item.inventarioID !== idInv) return item
        if (campo === 'cantidad') {
          const num = Math.max(1, Math.min(parseInt(valor, 10) || 1, item.stockMax))
          return { ...item, cantidad: num }
        }
        return { ...item, [campo]: valor }
      })
    )
  }

  const quitarItemCarrito = (idInv) => {
    setCarritoGrupo((prev) => prev.filter((item) => item.inventarioID !== idInv))
  }

  const autorizarDespachoEnGrupo = async (e) => {
    e.preventDefault()
    if (!empGrupoIdEfectivo) {
      if (mostrarToast) mostrarToast('Selecciona al colaborador responsable del envío', 'alerta')
      return
    }
    if (carritoGrupo.length === 0) {
      if (mostrarToast) mostrarToast('Agrega al menos un material o herramienta a la lista', 'alerta')
      return
    }

    setProcesando(true)
    try {
      const res = await fetch(`${API_URL}/api/inventario/salida-grupo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empleadoID: parseInt(empGrupoIdEfectivo, 10),
          proyecto: proyectoGrupo,
          sitioTrabajo: sitioTrabajoGrupo.trim(),
          notasGenerales: notasGrupo.trim(),
          usuarioERP: etiquetaOperadorActivo,
          items: carritoGrupo
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al registrar salida en grupo')

      if (mostrarToast) mostrarToast(`✓ ${data.mensaje}`)
      setCarritoGrupo([])
      setSitioTrabajoGrupo('')
      setNotasGrupo('')
      setPestanaInterna('prestamos')
      await cargarAlmacen()
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setProcesando(false)
    }
  }

  const marcarHerramientaDevuelta = async (mov) => {
    setProcesando(true)
    try {
      const res = await fetch(`${API_URL}/api/inventario/prestamo/${mov.MovimientoID}/devolver`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notasDevolucion: 'Reintegrado en almacén',
          usuarioERP: etiquetaOperadorActivo
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al devolver herramienta')

      if (mostrarToast) mostrarToast(`"${mov.NombreProducto}" devuelto al stock`)
      await cargarAlmacen()
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setProcesando(false)
    }
  }

  const devolverKitCompleto = async (folioGrupo) => {
    if (!folioGrupo) return
    setProcesando(true)
    try {
      const res = await fetch(`${API_URL}/api/inventario/prestamo-grupo/${folioGrupo}/devolver`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuarioERP: etiquetaOperadorActivo })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al devolver el kit')

      if (mostrarToast) mostrarToast(`✓ ${data.mensaje}`)
      await cargarAlmacen()
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setProcesando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* BARRA SUPERIOR DE NAVEGACIÓN DEL CENTRO DE ALMACÉN */}
      <div
        className="pro-card"
        style={{
          padding: '12px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div className="pro-segmented" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`pro-segmented-btn ${pestanaInterna === 'hub' ? 'active' : ''}`}
            onClick={() => setPestanaInterna('hub')}
          >
            🏠 Panel Principal
          </button>
          <button
            type="button"
            className={`pro-segmented-btn ${pestanaInterna === 'inventario' ? 'active' : ''}`}
            onClick={() => setPestanaInterna('inventario')}
          >
            📦 Existencias ({inventario.length})
          </button>
          <button
            type="button"
            className={`pro-segmented-btn ${pestanaInterna === 'grupo' ? 'active' : ''}`}
            onClick={() => setPestanaInterna('grupo')}
          >
            🧰 Envío en Grupo a Sitio
          </button>
          <button
            type="button"
            className={`pro-segmented-btn ${pestanaInterna === 'prestamos' ? 'active' : ''}`}
            onClick={() => setPestanaInterna('prestamos')}
          >
            🛠️ Préstamos ({prestamosActivos.length})
          </button>
          <button
            type="button"
            className={`pro-segmented-btn ${pestanaInterna === 'recepcion' ? 'active' : ''}`}
            onClick={() => setPestanaInterna('recepcion')}
          >
            📥 Recepción ({comprasPendientesRecepcion.length})
          </button>
          <button
            type="button"
            className={`pro-segmented-btn ${pestanaInterna === 'kardex' ? 'active' : ''}`}
            onClick={() => setPestanaInterna('kardex')}
          >
            📋 Kardex ({movimientos.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            className="pro-badge pro-mono"
            style={{ backgroundColor: '#f1f5f9', color: '#334155', fontSize: '11.5px', padding: '6px 10px' }}
            title="Usuario activo que quedará registrado en los movimientos"
          >
            👤 Operador: <strong>{etiquetaOperadorActivo}</strong>
          </span>

          {puedeEditar && (
            <button
              type="button"
              onClick={() => abrirModalEntradaManual(null, null)}
              className="pro-btn pro-btn-primary"
            >
              ➕ Añadir Artículo / Sumar Stock
            </button>
          )}
        </div>
      </div>

      {/* =====================================================================
          VISTA 0: CENTRO DE MANDO VISUAL DE ALMACÉN (PANTALLA PRINCIPAL)
      ===================================================================== */}
      {pestanaInterna === 'hub' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px' }}>
            <div
              onClick={() => setPestanaInterna('inventario')}
              className="pro-card"
              style={estilosHub.cardInteractivo('#0071e3', '#eff6ff')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={estilosHub.iconoGrande('#dbeafe')}>📦</span>
                <span className="pro-badge" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: 700 }}>
                  {inventario.reduce((acc, i) => acc + (Number(i.CantidadStock) || 0), 0)} pzas
                </span>
              </div>
              <h3 style={{ fontSize: '15.5px', margin: '12px 0 4px', color: '#1d1d1f' }}>
                Consultar Existencias y 3D
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                Buscador rápido, suma de stock y localizador 3D flotante por pieza.
              </p>
            </div>

            <div
              onClick={() => setPestanaInterna('grupo')}
              className="pro-card"
              style={estilosHub.cardInteractivo('#059669', '#ecfdf5')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={estilosHub.iconoGrande('#d1fae5')}>🧰</span>
                <span className="pro-badge" style={{ backgroundColor: '#d1fae5', color: '#065f46', fontWeight: 700 }}>
                  Salida Múltiple
                </span>
              </div>
              <h3 style={{ fontSize: '15.5px', margin: '12px 0 4px', color: '#1d1d1f' }}>
                Envío en Grupo a Sitio
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                Arma paquetes de herramientas y materiales para cuadrillas que salen a planta.
              </p>
            </div>

            <div
              onClick={() => setPestanaInterna('prestamos')}
              className="pro-card"
              style={estilosHub.cardInteractivo('#d97706', '#fffbeb')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={estilosHub.iconoGrande('#fef3c7')}>🛠️</span>
                <span className="pro-badge" style={{ backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
                  {prestamosActivos.length} activos
                </span>
              </div>
              <h3 style={{ fontSize: '15.5px', margin: '12px 0 4px', color: '#1d1d1f' }}>
                Préstamos y Devoluciones
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                Control de herramientas prestadas por empleado o kit y reingreso en 1 clic.
              </p>
            </div>

            <div
              onClick={() => setPestanaInterna('recepcion')}
              className="pro-card"
              style={estilosHub.cardInteractivo('#7c3aed', '#f5f3ff')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={estilosHub.iconoGrande('#ede9fe')}>📥</span>
                <span className="pro-badge" style={{ backgroundColor: '#ede9fe', color: '#5b21b6', fontWeight: 700 }}>
                  {comprasPendientesRecepcion.length} por recibir
                </span>
              </div>
              <h3 style={{ fontSize: '15.5px', margin: '12px 0 4px', color: '#1d1d1f' }}>
                Recepción de Compras
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                Ingresa al almacén las órdenes marcadas como &ldquo;Comprado&rdquo; y asigna su rack 3D.
              </p>
            </div>

            <div
              onClick={() => setPestanaInterna('kardex')}
              className="pro-card"
              style={estilosHub.cardInteractivo('#334155', '#f8fafc')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={estilosHub.iconoGrande('#e2e8f0')}>📋</span>
                <span className="pro-badge" style={{ backgroundColor: '#e2e8f0', color: '#1e293b', fontWeight: 700 }}>
                  {movimientos.length} registros
                </span>
              </div>
              <h3 style={{ fontSize: '15.5px', margin: '12px 0 4px', color: '#1d1d1f' }}>
                Kardex y Bitácora Dinámica
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                Auditoría por operador ERP, empleado receptor, fechas y folios de salida.
              </p>
            </div>

            {irAlVisor3D && (
              <div
                onClick={irAlVisor3D}
                className="pro-card"
                style={estilosHub.cardInteractivo('#0284c7', '#f0f9ff')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={estilosHub.iconoGrande('#e0f2fe')}>🧊</span>
                  <span className="pro-badge" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', fontWeight: 700 }}>
                    Visor 3D
                  </span>
                </div>
                <h3 style={{ fontSize: '15.5px', margin: '12px 0 4px', color: '#1d1d1f' }}>
                  Gemelo Digital 3D Completo
                </h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                  Explora la nave de almacén en pantalla completa y consulta racks interactivos.
                </p>
              </div>
            )}
          </div>

          {/* SECCIÓN DE ANÁLISIS Y PREVISIÓN CON GRÁFICAS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(410px, 1fr))', gap: '18px' }}>
            <div className="pro-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <h4 style={{ fontSize: '14.5px', margin: 0 }}>🔥 Artículos con Mayor Demanda y Salidas</h4>
                  <span style={{ fontSize: '11.5px', color: '#86868b' }}>
                    Previsión de consumo y préstamo acumulado para anticipar compras
                  </span>
                </div>
                <span className="pro-badge pro-mono" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                  Salidas: {analiticaAlmacen.totalSalidas + analiticaAlmacen.totalPrestamos} u.
                </span>
              </div>

              {analiticaAlmacen.topMasSalidas.length === 0 ? (
                <div style={{ padding: '28px', textAlign: 'center', color: '#86868b', fontSize: '12.5px' }}>
                  Aún no hay salidas registradas para graficar tendencias de consumo.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {analiticaAlmacen.topMasSalidas.map((art, idx) => {
                    const pct = Math.round((art.unidades / analiticaAlmacen.maxSalidaUnidades) * 100)
                    return (
                      <div key={idx}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                          <strong style={{ color: '#1d1d1f' }}>
                            #{idx + 1} · {art.nombre}
                          </strong>
                          <span className="pro-mono" style={{ fontWeight: 700, color: '#0071e3' }}>
                            {art.unidades} u. ({art.eventos} movs)
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '9px', backgroundColor: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, #0071e3, #38bdf8)',
                              borderRadius: '999px'
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="pro-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <h4 style={{ fontSize: '14.5px', margin: 0 }}>⚠️ Previsión de Stock Crítico (≤ 5 unidades)</h4>
                  <span style={{ fontSize: '11.5px', color: '#86868b' }}>
                    Materiales próximos a agotarse con acceso rápido a reabastecimiento o vista 3D
                  </span>
                </div>
              </div>

              {analiticaAlmacen.articulosCriticos.length === 0 ? (
                <div style={{ padding: '28px', textAlign: 'center', color: '#059669', fontSize: '13px', fontWeight: 600 }}>
                  ✓ Todos los artículos cuentan con nivel de stock saludable (&gt; 5 unidades).
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {analiticaAlmacen.articulosCriticos.map((item) => {
                    const stock = Number(item.CantidadStock) || 0
                    return (
                      <div
                        key={item.ID}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '10px',
                          backgroundColor: stock === 0 ? '#fef2f2' : '#fffbeb',
                          border: `1px solid ${stock === 0 ? '#fecaca' : '#fde68a'}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px',
                          flexWrap: 'wrap'
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: '13px', color: '#1d1d1f' }}>{item.NombreProducto}</strong>
                          <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                            📍 Rack 3D: <strong>{item.Ubicacion3D || 'Sin asignar'}</strong> · Stock: <strong>{stock} u.</strong>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setItemFlotante3D(item)}
                            className="pro-btn pro-btn-secondary pro-btn-sm"
                          >
                            📍 Ver en 3D
                          </button>
                          {puedeEditar && (
                            <button
                              type="button"
                              onClick={() => abrirModalEntradaManual(item, null)}
                              className="pro-btn pro-btn-primary pro-btn-sm"
                            >
                              ＋ Abastecer
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          VISTA 1: EXISTENCIAS DINÁMICAS CON BOTÓN DE VENTANA FLOTANTE 3D
      ===================================================================== */}
      {pestanaInterna === 'inventario' && (
        <div className="pro-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
              <input
                type="text"
                placeholder="🔍 Buscar rápido por nombre de material, herramienta, #ID o ubicación 3D..."
                value={busquedaInv}
                onChange={(e) => setBusquedaInv(e.target.value)}
                className="pro-input"
                style={{ maxWidth: '390px' }}
              />

              <select
                value={filtroUbicacionInv}
                onChange={(e) => setFiltroUbicacionInv(e.target.value)}
                className="pro-select"
                style={{ maxWidth: '190px' }}
              >
                <option value="TODAS">📍 Todas las Ubicaciones 3D</option>
                {ubicaciones3DUnicas.map((u) => (
                  <option key={u} value={u}>Rack / Nodo: {u}</option>
                ))}
              </select>
            </div>

            <div className="pro-segmented">
              <button
                type="button"
                className={`pro-segmented-btn ${filtroStockInv === 'TODOS' ? 'active' : ''}`}
                onClick={() => setFiltroStockInv('TODOS')}
              >
                Todos ({inventario.length})
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${filtroStockInv === 'DISPONIBLE' ? 'active' : ''}`}
                onClick={() => setFiltroStockInv('DISPONIBLE')}
              >
                🟢 Con Stock
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${filtroStockInv === 'BAJO' ? 'active' : ''}`}
                onClick={() => setFiltroStockInv('BAJO')}
              >
                ⚠️ Bajo (≤5)
              </button>
              <button
                type="button"
                className={`pro-segmented-btn ${filtroStockInv === 'AGOTADO' ? 'active' : ''}`}
                onClick={() => setFiltroStockInv('AGOTADO')}
              >
                🔴 Agotados
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-light)', backgroundColor: '#f8fafc', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>ID</th>
                  <th style={{ padding: '10px 12px' }}>Producto / Herramienta</th>
                  <th style={{ padding: '10px 12px' }}>Ubicación 3D (Visor Flotante)</th>
                  <th style={{ padding: '10px 12px' }}>Estado</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stock Actual</th>
                  <th style={{ padding: '10px 12px' }}>Último Movimiento</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Operaciones Rápidas</th>
                </tr>
              </thead>
              <tbody>
                {inventarioFiltrado.map((item) => {
                  const stock = Number(item.CantidadStock) || 0
                  const sinStock = stock <= 0
                  return (
                    <tr key={item.ID} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td className="pro-mono" style={{ padding: '10px 12px', fontWeight: 700 }}>#{item.ID}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1d1d1f' }}>{item.NombreProducto}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <button
                          type="button"
                          onClick={() => setItemFlotante3D(item)}
                          className="pro-btn pro-btn-secondary pro-btn-sm"
                          style={{
                            backgroundColor: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            fontWeight: 700
                          }}
                          title="Abrir ventana flotante con la ubicación en el modelo 3D"
                        >
                          📍 {item.Ubicacion3D || 'Pieza1'} · Ver en 3D
                        </button>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          className="pro-badge"
                          style={{
                            backgroundColor: sinStock ? '#fef2f2' : stock <= 5 ? '#fffbeb' : '#ecfdf5',
                            color: sinStock ? '#991b1b' : stock <= 5 ? '#92400e' : '#065f46'
                          }}
                        >
                          {item.Estado || (sinStock ? 'Agotado' : 'Almacenado')}
                        </span>
                      </td>
                      <td
                        className="pro-mono"
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontSize: '15px',
                          fontWeight: 800,
                          color: sinStock ? '#dc2626' : '#1d1d1f'
                        }}
                      >
                        {stock}
                      </td>
                      <td className="pro-mono" style={{ padding: '10px 12px', fontSize: '11.5px', color: '#86868b' }}>
                        {item.FechaActualizacion ? new Date(item.FechaActualizacion).toLocaleString('es-MX') : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {puedeEditar && (
                            <>
                              <button
                                type="button"
                                onClick={() => abrirModalEntradaManual(item, null)}
                                className="pro-btn pro-btn-secondary pro-btn-sm"
                              >
                                ＋ Sumar Stock
                              </button>
                              <button
                                type="button"
                                disabled={sinStock}
                                onClick={() => abrirModalSalidaItem(item, 'Prestamo Herramienta')}
                                className="pro-btn pro-btn-primary pro-btn-sm"
                              >
                                🛠️ Prestar
                              </button>
                              <button
                                type="button"
                                disabled={sinStock}
                                onClick={() => abrirModalSalidaItem(item, 'Salida Consumo')}
                                className="pro-btn pro-btn-dark pro-btn-sm"
                              >
                                📤 Dar Salida
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          VISTA 2: ENVÍO DE MATERIALES Y HERRAMIENTAS EN GRUPO A SITIO
      ===================================================================== */}
      {pestanaInterna === 'grupo' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '18px', alignItems: 'start' }}>
          <div className="pro-card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '15.5px', margin: 0 }}>1. Selecciona Materiales o Herramientas del Almacén</h3>
              <span style={{ fontSize: '12px', color: '#86868b' }}>
                Haz clic en &ldquo;＋ Agregar al Envío&rdquo; para armar el paquete que sale a sitio
              </span>
            </div>

            <input
              type="text"
              placeholder="🔍 Filtrar catálogo por nombre o ubicación 3D..."
              value={busquedaSelectorGrupo}
              onChange={(e) => setBusquedaSelectorGrupo(e.target.value)}
              className="pro-input"
            />

            <div style={{ maxHeight: '460px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                    <th style={{ padding: '9px 12px' }}>Artículo / Herramienta</th>
                    <th style={{ padding: '9px 12px' }}>Ubicación 3D</th>
                    <th style={{ padding: '9px 12px', textAlign: 'right' }}>Disponible</th>
                    <th style={{ padding: '9px 12px', textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {inventario
                    .filter((i) => {
                      const q = busquedaSelectorGrupo.trim().toLowerCase()
                      if (!q) return true
                      return (
                        String(i.NombreProducto || '').toLowerCase().includes(q) ||
                        String(i.Ubicacion3D || '').toLowerCase().includes(q)
                      )
                    })
                    .map((item) => {
                      const stock = Number(item.CantidadStock) || 0
                      const enCarrito = carritoGrupo.find((c) => c.inventarioID === item.ID)
                      return (
                        <tr key={item.ID} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', opacity: stock > 0 ? 1 : 0.5 }}>
                          <td style={{ padding: '9px 12px', fontWeight: 700 }}>{item.NombreProducto}</td>
                          <td style={{ padding: '9px 12px' }}>
                            <span className="pro-badge" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                              📍 {item.Ubicacion3D || 'Pieza1'}
                            </span>
                          </td>
                          <td className="pro-mono" style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800 }}>
                            {stock}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                            <button
                              type="button"
                              disabled={stock <= 0 || !puedeEditar}
                              onClick={() => agregarItemAlCarritoGrupo(item)}
                              className={`pro-btn pro-btn-sm ${enCarrito ? 'pro-btn-success' : 'pro-btn-primary'}`}
                            >
                              {enCarrito ? `✓ En Lista (${enCarrito.cantidad})` : '＋ Agregar al Envío'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>

          <form onSubmit={autorizarDespachoEnGrupo} className="pro-card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '15.5px', margin: 0 }}>2. Vale de Envío en Grupo a Sitio Externo</h3>
                <span style={{ fontSize: '12px', color: '#86868b' }}>
                  Autoriza: <strong>{etiquetaOperadorActivo}</strong>
                </span>
              </div>
              <span className="pro-badge" style={{ backgroundColor: '#ecfdf5', color: '#065f46', fontWeight: 800 }}>
                {carritoGrupo.length} partidas
              </span>
            </div>

            <div>
              <label className="pro-label">Colaborador Responsable de la Cuadrilla / Kit (RH Activo) *</label>
              <select
                value={empGrupoIdEfectivo}
                onChange={(e) => setEmpGrupoId(e.target.value)}
                required
                className="pro-select"
              >
                <option value="">-- Seleccionar responsable --</option>
                {personalActivo.map((emp) => (
                  <option key={emp.EmpleadoID} value={emp.EmpleadoID}>
                    {emp.NombreCompleto} — ({emp.Departamento} {emp.Puesto ? `· ${emp.Puesto}` : ''})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label className="pro-label">Proyecto Asociado</label>
                <select
                  value={proyectoGrupo}
                  onChange={(e) => setProyectoGrupo(e.target.value)}
                  className="pro-select"
                >
                  <option value="">-- Seleccionar proyecto --</option>
                  {proyectos.map((p, idx) => (
                    <option key={idx} value={p.NombreProyecto || p}>
                      {p.NombreProyecto || p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="pro-label">Planta / Sitio de Trabajo Destino *</label>
                <input
                  type="text"
                  placeholder="Ej. Planta Cliente / Nave 4 / Instalación Externa..."
                  value={sitioTrabajoGrupo}
                  onChange={(e) => setSitioTrabajoGrupo(e.target.value)}
                  required
                  className="pro-input"
                />
              </div>
            </div>

            <div>
              <label className="pro-label">Notas / Condiciones del Envío en Grupo</label>
              <input
                type="text"
                placeholder="Ej. Caja de herramientas completa para montaje de fin de semana..."
                value={notasGrupo}
                onChange={(e) => setNotasGrupo(e.target.value)}
                className="pro-input"
              />
            </div>

            <div style={{ border: '1px solid var(--border-light)', borderRadius: '10px', overflow: 'hidden' }}>
              {carritoGrupo.length === 0 ? (
                <div style={{ padding: '26px', textAlign: 'center', color: '#86868b', fontSize: '12.5px', backgroundColor: '#f8fafc' }}>
                  No has agregado materiales ni herramientas al paquete. Selecciona artículos de la tabla izquierda.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px' }}>Artículo</th>
                      <th style={{ padding: '8px 10px' }}>Modalidad</th>
                      <th style={{ padding: '8px 10px', width: '90px' }}>Cantidad</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Quitar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carritoGrupo.map((item) => (
                      <tr key={item.inventarioID} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                          {item.nombreProducto}
                          <div style={{ fontSize: '10.5px', color: '#86868b' }}>Máx: {item.stockMax} u.</div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <select
                            value={item.tipoMovimiento}
                            onChange={(e) => actualizarItemCarrito(item.inventarioID, 'tipoMovimiento', e.target.value)}
                            className="pro-select"
                            style={{ padding: '4px 8px', fontSize: '11.5px' }}
                          >
                            <option value="Prestamo Herramienta">🛠️ Préstamo (Retornable)</option>
                            <option value="Salida Consumo">📤 Consumo Definitivo</option>
                          </select>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <input
                            type="number"
                            min="1"
                            max={item.stockMax}
                            value={item.cantidad}
                            onChange={(e) => actualizarItemCarrito(item.inventarioID, 'cantidad', e.target.value)}
                            className="pro-input pro-mono"
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                          />
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => quitarItemCarrito(item.inventarioID)}
                            className="pro-btn pro-btn-danger pro-btn-sm"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {puedeEditar && (
              <button
                type="submit"
                disabled={procesando || carritoGrupo.length === 0}
                className="pro-btn pro-btn-primary"
                style={{ padding: '11px', fontWeight: 700 }}
              >
                {procesando ? 'Procesando Envío...' : `🚀 Autorizar Salida en Grupo (${carritoGrupo.length} artículos)`}
              </button>
            )}
          </form>
        </div>
      )}

      {/* =====================================================================
          VISTA 3: PRÉSTAMOS ACTIVOS (INDIVIDUALES Y KITS EN SITIO)
      ===================================================================== */}
      {pestanaInterna === 'prestamos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="pro-card" style={{ padding: '18px' }}>
            <h3 style={{ fontSize: '15.5px', marginBottom: '4px' }}>
              🛠️ Herramientas y Kits Prestados en Sitio Pendientes de Devolución
            </h3>
            <p style={{ fontSize: '12px', color: '#86868b', marginBottom: '14px' }}>
              Puedes recibir la devolución pieza por pieza o reintegrar todo un paquete de salida a sitio en un solo clic.
            </p>

            {kitsEnSitioActivos.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#86868b' }}>
                No hay herramientas ni kits prestados pendientes de devolución en este momento.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {kitsEnSitioActivos.map((grupo, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid var(--border-light)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      backgroundColor: '#ffffff'
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 16px',
                        backgroundColor: grupo.esGrupo ? '#eff6ff' : '#f8fafc',
                        borderBottom: '1px solid var(--border-light)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '10px'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span
                            className="pro-badge pro-mono"
                            style={{
                              backgroundColor: grupo.esGrupo ? '#1d4ed8' : '#334155',
                              color: '#ffffff',
                              fontWeight: 700
                            }}
                          >
                            {grupo.esGrupo ? `🧰 KIT: ${grupo.folio}` : '🛠️ Préstamo Individual'}
                          </span>
                          <strong style={{ fontSize: '14px', color: '#1d1d1f' }}>
                            Responsable: {grupo.empleado}
                          </strong>
                          <span style={{ fontSize: '12px', color: '#515154' }}>
                            · Destino: <strong>{grupo.proyecto}</strong>
                          </span>
                        </div>
                        <div className="pro-mono" style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                          Salida: {new Date(grupo.fecha).toLocaleString('es-MX')} · Entregó en almacén: {grupo.operadorERP}
                        </div>
                      </div>

                      {puedeEditar && grupo.esGrupo && grupo.partidas.length > 1 && (
                        <button
                          type="button"
                          disabled={procesando}
                          onClick={() => devolverKitCompleto(grupo.folio)}
                          className="pro-btn pro-btn-success pro-btn-sm"
                        >
                          ✓ Recibir Todo el Kit ({grupo.partidas.length} partidas)
                        </button>
                      )}
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                      <tbody>
                        {grupo.partidas.map((mov) => (
                          <tr key={mov.MovimientoID} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                            <td className="pro-mono" style={{ padding: '9px 14px', width: '80px' }}>#{mov.MovimientoID}</td>
                            <td style={{ padding: '9px 14px', fontWeight: 700 }}>{mov.NombreProducto}</td>
                            <td className="pro-mono" style={{ padding: '9px 14px', fontWeight: 800 }}>
                              {mov.Cantidad} u.
                            </td>
                            <td style={{ padding: '9px 14px', color: '#64748b' }}>{mov.Notas || '—'}</td>
                            {puedeEditar && (
                              <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                                <button
                                  type="button"
                                  disabled={procesando}
                                  onClick={() => marcarHerramientaDevuelta(mov)}
                                  className="pro-btn pro-btn-primary pro-btn-sm"
                                >
                                  ✓ Recibir Pieza
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          VISTA 4: RECEPCIÓN DESDE COMPRAS
      ===================================================================== */}
      {pestanaInterna === 'recepcion' && (
        <div className="pro-card" style={{ padding: '18px' }}>
          <h3 style={{ fontSize: '15.5px', marginBottom: '12px' }}>
            📥 Órdenes con Estatus &ldquo;Comprado&rdquo; Pendientes de Ingresar al Almacén
          </h3>
          {comprasPendientesRecepcion.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#86868b' }}>
              Todas las compras con estatus &ldquo;Comprado&rdquo; ya han sido recibidas en el almacén.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-light)', backgroundColor: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>Compra #</th>
                    <th style={{ padding: '10px 12px' }}>Producto</th>
                    <th style={{ padding: '10px 12px' }}>Material / Categoría</th>
                    <th style={{ padding: '10px 12px' }}>Proveedor</th>
                    <th style={{ padding: '10px 12px' }}>Proyecto</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Cantidad</th>
                    {puedeEditar && <th style={{ padding: '10px 12px', textAlign: 'right' }}>Ingresar</th>}
                  </tr>
                </thead>
                <tbody>
                  {comprasPendientesRecepcion.map((c) => (
                    <tr key={c.Numero} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td className="pro-mono" style={{ padding: '10px 12px', fontWeight: 700 }}>#{c.Numero}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>{c.Producto}</td>
                      <td style={{ padding: '10px 12px' }}>{c.Material || c.Categoria || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{c.Proveedor}</td>
                      <td style={{ padding: '10px 12px' }}>{c.Proyecto || 'Stock General'}</td>
                      <td className="pro-mono" style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                        {c.Cantidad}
                      </td>
                      {puedeEditar && (
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => abrirModalEntradaManual(null, c)}
                            className="pro-btn pro-btn-primary pro-btn-sm"
                          >
                            📥 Dar Entrada a Almacén
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          VISTA 5: KARDEX DINÁMICO Y MULTIFILTRO
      ===================================================================== */}
      {pestanaInterna === 'kardex' && (
        <div className="pro-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="🔍 Buscar por material, empleado RH, operador ERP, proyecto o folio SITIO-..."
              value={busquedaKardex}
              onChange={(e) => setBusquedaKardex(e.target.value)}
              className="pro-input"
              style={{ maxWidth: '420px' }}
            />

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <div className="pro-segmented">
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroTipoKardex === 'TODOS' ? 'active' : ''}`}
                  onClick={() => setFiltroTipoKardex('TODOS')}
                >
                  Todos ({movimientosFiltrados.length})
                </button>
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroTipoKardex === 'ENTRADAS' ? 'active' : ''}`}
                  onClick={() => setFiltroTipoKardex('ENTRADAS')}
                >
                  📥 Entradas
                </button>
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroTipoKardex === 'SALIDAS' ? 'active' : ''}`}
                  onClick={() => setFiltroTipoKardex('SALIDAS')}
                >
                  📤 Salidas
                </button>
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroTipoKardex === 'PRESTAMOS' ? 'active' : ''}`}
                  onClick={() => setFiltroTipoKardex('PRESTAMOS')}
                >
                  🛠️ Préstamos
                </button>
                <button
                  type="button"
                  className={`pro-segmented-btn ${filtroTipoKardex === 'GRUPO' ? 'active' : ''}`}
                  onClick={() => setFiltroTipoKardex('GRUPO')}
                >
                  🧰 Kits en Sitio
                </button>
              </div>

              <select
                value={filtroPeriodoKardex}
                onChange={(e) => setFiltroPeriodoKardex(e.target.value)}
                className="pro-select"
                style={{ width: '150px' }}
              >
                <option value="TODOS">📅 Todo el historial</option>
                <option value="HOY">Hoy</option>
                <option value="SEMANA">Últimos 7 días</option>
                <option value="MES">Últimos 30 días</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-light)', backgroundColor: '#f8fafc', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>Fecha</th>
                  <th style={{ padding: '10px 12px' }}>Tipo / Folio Grupo</th>
                  <th style={{ padding: '10px 12px' }}>Artículo / Herramienta</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Cant.</th>
                  <th style={{ padding: '10px 12px' }}>Registró en ERP (Sesión)</th>
                  <th style={{ padding: '10px 12px' }}>Recibió (Personal RH)</th>
                  <th style={{ padding: '10px 12px' }}>Proyecto / Sitio</th>
                  <th style={{ padding: '10px 12px' }}>Estado</th>
                  <th style={{ padding: '10px 12px' }}>Notas</th>
                </tr>
              </thead>
              <tbody>
                {movimientosFiltrados.map((m) => {
                  const esEntrada =
                    String(m.TipoMovimiento).includes('Entrada') ||
                    String(m.TipoMovimiento).includes('Recepcion')
                  return (
                    <tr key={m.MovimientoID} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td className="pro-mono" style={{ padding: '9px 12px', fontSize: '11.5px' }}>
                        {new Date(m.FechaMovimiento).toLocaleString('es-MX')}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span
                          className="pro-badge"
                          style={{
                            backgroundColor: esEntrada
                              ? '#ecfdf5'
                              : m.TipoMovimiento === 'Prestamo Herramienta'
                                ? '#eff6ff'
                                : '#fef2f2',
                            color: esEntrada
                              ? '#065f46'
                              : m.TipoMovimiento === 'Prestamo Herramienta'
                                ? '#1d4ed8'
                                : '#991b1b'
                          }}
                        >
                          {m.TipoMovimiento}
                        </span>
                        {m.FolioGrupo && (
                          <div className="pro-mono" style={{ fontSize: '10.5px', color: '#1d4ed8', fontWeight: 700, marginTop: '2px' }}>
                            🧰 {m.FolioGrupo}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 700 }}>{m.NombreProducto}</td>
                      <td
                        className="pro-mono"
                        style={{
                          padding: '9px 12px',
                          textAlign: 'right',
                          fontWeight: 800,
                          color: esEntrada ? '#059669' : '#dc2626'
                        }}
                      >
                        {esEntrada ? `+${m.Cantidad}` : `-${m.Cantidad}`}
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 600, color: '#334155' }}>
                        👤 {m.UsuarioERP || etiquetaOperadorActivo}
                      </td>
                      <td style={{ padding: '9px 12px' }}>{m.NombreEmpleado || '—'}</td>
                      <td style={{ padding: '9px 12px' }}>{m.Proyecto || '—'}</td>
                      <td style={{ padding: '9px 12px' }}>
                        {m.EstatusPrestamo ? (
                          <span
                            className="pro-badge"
                            style={{
                              backgroundColor: m.EstatusPrestamo === 'Devuelto' ? '#ecfdf5' : '#fffbeb',
                              color: m.EstatusPrestamo === 'Devuelto' ? '#065f46' : '#92400e'
                            }}
                          >
                            {m.EstatusPrestamo}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#515154' }}>{m.Notas || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          VENTANA FLOTANTE 3D PARA MOSTRAR UBICACIÓN DE UN ARTÍCULO (SIN SCROLL)
      ===================================================================== */}
      {itemFlotante3D &&
        createPortal(
          <div
            className="pro-modal-backdrop"
            style={{ zIndex: 99999 }}
            onClick={() => setItemFlotante3D(null)}
          >
            <div
              className="pro-modal-window"
              style={{
                maxWidth: '1080px',
                width: '94vw',
                height: '86vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="pro-modal-header"
                style={{
                  padding: '14px 22px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  flexShrink: 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '22px' }}>🧊</span>
                  <div>
                    <h3 style={{ fontSize: '16px', margin: 0, color: '#ffffff' }}>
                      Localizador 3D: {itemFlotante3D.NombreProducto}
                    </h3>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Ubicado en Nodo / Rack 3D:{' '}
                      <strong style={{ color: '#38bdf8' }}>
                        {itemFlotante3D.Ubicacion3D || 'Pieza1'}
                      </strong>{' '}
                      · Stock disponible:{' '}
                      <strong style={{ color: '#34d399' }}>
                        {itemFlotante3D.CantidadStock} unidades
                      </strong>
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setItemFlotante3D(null)}
                  className="pro-btn pro-btn-secondary pro-btn-sm"
                >
                  ✕ Cerrar Vista Flotante
                </button>
              </div>

              <div
                style={{
                  flex: 1,
                  position: 'relative',
                  overflow: 'hidden',
                  backgroundColor: '#f8fafc',
                  padding: '12px',
                  boxSizing: 'border-box'
                }}
              >
                <GestionAlmacen3D
                  API_URL={API_URL}
                  ubicacionResaltada={itemFlotante3D.Ubicacion3D}
                  productoResaltado={itemFlotante3D}
                  esModal={true}
                  syncTrigger={syncTrigger}
                />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =====================================================================
          MODAL PARA ENTRADA MANUAL / SUMA DE STOCK (CON USUARIO ACTIVO)
      ===================================================================== */}
      {modalEntrada &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalEntrada(false)}>
            <div className="pro-modal-window" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <h3 style={{ fontSize: '16px', margin: 0 }}>
                  {compraSeleccionada
                    ? `📥 Recibir Compra #${compraSeleccionada.Numero} en Almacén`
                    : '➕ Alta de Producto o Suma de Stock en Almacén'}
                </h3>
                <button onClick={() => setModalEntrada(false)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>

              <form onSubmit={guardarEntradaInventario} className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#1e3a8a', fontWeight: 600 }}>
                    👤 Registrado por (Cuenta Activa):
                  </span>
                  <strong className="pro-mono" style={{ fontSize: '12.5px', color: '#1d4ed8' }}>
                    {etiquetaOperadorActivo}
                  </strong>
                </div>

                <div className="pro-segmented" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <button
                    type="button"
                    className={`pro-segmented-btn ${modoEntrada === 'existente' ? 'active' : ''}`}
                    onClick={() => setModoEntrada('existente')}
                  >
                    📦 Sumar a Existente
                  </button>
                  <button
                    type="button"
                    className={`pro-segmented-btn ${modoEntrada === 'nuevo' ? 'active' : ''}`}
                    onClick={() => setModoEntrada('nuevo')}
                  >
                    ✨ Nuevo Producto / Herramienta
                  </button>
                </div>

                {modoEntrada === 'existente' ? (
                  <div>
                    <label className="pro-label">Selecciona el Artículo de `InventarioAlmacen` *</label>
                    <select
                      value={idItemEntrada}
                      onChange={(e) => {
                        setIdItemEntrada(e.target.value)
                        const sel = inventario.find((i) => String(i.ID) === e.target.value)
                        if (sel?.Ubicacion3D) setUbicacion3DInput(sel.Ubicacion3D)
                      }}
                      required
                      className="pro-select"
                    >
                      <option value="">-- Seleccionar --</option>
                      {inventario.map((i) => (
                        <option key={i.ID} value={i.ID}>
                          #{i.ID} - {i.NombreProducto} (Stock actual: {i.CantidadStock})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="pro-label">Nombre del Nuevo Producto o Herramienta *</label>
                    <input
                      type="text"
                      placeholder="Ej. TALADRO MILWAUKEE M18 / ACERO 1045..."
                      value={nombreNuevoProd}
                      onChange={(e) => setNombreNuevoProd(e.target.value)}
                      required
                      className="pro-input"
                    />
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="pro-label">Cantidad a Ingresar *</label>
                    <input
                      type="number"
                      min="1"
                      value={cantidadEntrada}
                      onChange={(e) => setCantidadEntrada(e.target.value)}
                      required
                      className="pro-input pro-mono"
                    />
                  </div>
                  <div>
                    <label className="pro-label">Ubicación 3D (Rack / Nodo GLB) *</label>
                    <input
                      type="text"
                      placeholder="Ej. Pieza1, A7, Rack3..."
                      value={ubicacion3DInput}
                      onChange={(e) => setUbicacion3DInput(e.target.value)}
                      required
                      className="pro-input pro-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="pro-label">Notas / Referencia de Entrada</label>
                  <input
                    type="text"
                    placeholder="Ej. Inventario físico inicial, ajuste de stock..."
                    value={notasEntrada}
                    onChange={(e) => setNotasEntrada(e.target.value)}
                    className="pro-input"
                  />
                </div>

                <div className="pro-modal-footer" style={{ padding: '12px 0 0 0' }}>
                  <button type="button" onClick={() => setModalEntrada(false)} className="pro-btn pro-btn-secondary">
                    Cancelar
                  </button>
                  <button type="submit" disabled={procesando} className="pro-btn pro-btn-primary">
                    {procesando ? 'Guardando...' : '💾 Confirmar Entrada'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* =====================================================================
          MODAL PARA SALIDA INDIVIDUAL O PRÉSTAMO DE HERRAMIENTA
      ===================================================================== */}
      {modalSalida &&
        itemParaSalida &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setModalSalida(false)}>
            <div className="pro-modal-window" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-header">
                <div>
                  <h3 style={{ fontSize: '16px', margin: 0 }}>
                    {tipoSalida === 'Prestamo Herramienta' ? '🛠️ Préstamo de Herramienta' : '📤 Salida de Material de Almacén'}
                  </h3>
                  <span style={{ fontSize: '12px', color: '#86868b' }}>
                    Artículo: <strong>{itemParaSalida.NombreProducto}</strong> (Disponible: {itemParaSalida.CantidadStock})
                  </span>
                </div>
                <button onClick={() => setModalSalida(false)} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
              </div>

              <form onSubmit={registrarSalidaOPrestamo} className="pro-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: '10px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid var(--border-light)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px'
                  }}
                >
                  <span>👤 Autoriza en Almacén:</span>
                  <strong className="pro-mono">{etiquetaOperadorActivo}</strong>
                </div>

                <div className="pro-segmented" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <button
                    type="button"
                    className={`pro-segmented-btn ${tipoSalida === 'Prestamo Herramienta' ? 'active' : ''}`}
                    onClick={() => setTipoSalida('Prestamo Herramienta')}
                  >
                    🛠️ Préstamo (Retornable)
                  </button>
                  <button
                    type="button"
                    className={`pro-segmented-btn ${tipoSalida === 'Salida Consumo' ? 'active' : ''}`}
                    onClick={() => setTipoSalida('Salida Consumo')}
                  >
                    📤 Salida Definitiva (Consumo)
                  </button>
                </div>

                <div>
                  <label className="pro-label">Entregar a Colaborador (Solo Personal Activo en RH) *</label>
                  <select
                    value={empleadoSeleccionado}
                    onChange={(e) => setEmpleadoSeleccionado(e.target.value)}
                    required
                    className="pro-select"
                  >
                    <option value="">-- Selecciona quién recibe --</option>
                    {personalActivo.map((emp) => (
                      <option key={emp.EmpleadoID} value={emp.EmpleadoID}>
                        {emp.NombreCompleto} — ({emp.Departamento} {emp.Puesto ? `· ${emp.Puesto}` : ''})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '12px' }}>
                  <div>
                    <label className="pro-label">Cantidad a Entregar *</label>
                    <input
                      type="number"
                      min="1"
                      max={itemParaSalida.CantidadStock}
                      value={cantidadSalida}
                      onChange={(e) => setCantidadSalida(e.target.value)}
                      required
                      className="pro-input pro-mono"
                    />
                  </div>
                  <div>
                    <label className="pro-label">Proyecto / Destino</label>
                    <select
                      value={proyectoDestino}
                      onChange={(e) => setProyectoDestino(e.target.value)}
                      className="pro-select"
                    >
                      <option value="">Uso General de Planta</option>
                      {proyectos.map((p, idx) => (
                        <option key={idx} value={p.NombreProyecto || p}>
                          {p.NombreProyecto || p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="pro-label">Observaciones / Estado de Entrega</label>
                  <input
                    type="text"
                    placeholder="Ej. Se entrega con estuche completo..."
                    value={notasSalida}
                    onChange={(e) => setNotasSalida(e.target.value)}
                    className="pro-input"
                  />
                </div>

                <div className="pro-modal-footer" style={{ padding: '12px 0 0 0' }}>
                  <button type="button" onClick={() => setModalSalida(false)} className="pro-btn pro-btn-secondary">
                    Cancelar
                  </button>
                  <button type="submit" disabled={procesando} className="pro-btn pro-btn-primary">
                    {procesando ? 'Registrando...' : '✓ Autorizar y Descontar Stock'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

const estilosHub = {
  cardInteractivo: (colorBorde, bgHover) => ({
    padding: '18px',
    cursor: 'pointer',
    border: '1px solid var(--border-light)',
    borderLeft: `4px solid ${colorBorde}`,
    background: `linear-gradient(180deg, #ffffff 0%, ${bgHover} 160%)`,
    transition: 'transform 0.16s ease, box-shadow 0.16s ease'
  }),
  iconoGrande: (bg) => ({
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px'
  })
}