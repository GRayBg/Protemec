import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function VistaConsulta({
  compras = [],
  iniciarEdicion,
  proveedoresUnicos = [],
  categoriasUnicas = [],
  puedeEditar = true
}) {
  const [mostrarFiltros, setMostrarFiltros] = useState(false)
  const [filasExpandidas, setFilasExpandidas] = useState({})
  const [archivoPrevisualizando, setArchivoPrevisualizando] = useState(null)

  const contenedorRef = useRef(null)

  const [busquedaRapida, setBusquedaRapida] = useState('')
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [filtroProyectoId, setFiltroProyectoId] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroMaterial, setFiltroMaterial] = useState('')
  const [filtroEstatus, setFiltroEstatus] = useState('')
  const [filtroFechaInicio, setFiltroFechaInicio] = useState('')
  const [filtroFechaFin, setFiltroFechaFin] = useState('')

  const toggleFilaExpandida = (id) => {
    setFilasExpandidas((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const comprasProcesadas = compras.map((c) => {
    const precioU = Number(c.PrecioUnitario || c.precioUnitario || 0)
    const cant = Number(c.Cantidad || c.cantidad || 0)
    const subtotal = Number(c.Costo || c.costo || precioU * cant || 0)
    const totalConIva = subtotal * 1.16

    return {
      ...c,
      _subtotalCalculado: subtotal,
      _totalConIvaCalculado: totalConIva
    }
  })

  const materialesUnicos = [...new Set(compras.map((c) => c.Material || c.material).filter(Boolean))]
  const proyectoIdsUnicos = [...new Set(compras.map((c) => c.ProyectoID_Externo || c.proyectoID_Externo).filter(Boolean))]
  const proyectosNombreUnicos = [...new Set(compras.map((c) => c.Proyecto || c.proyecto).filter(Boolean))]

  const comprasFiltradas = comprasProcesadas.filter((c) => {
    const est = (c.Estatus || c.estatus || 'Comprado').toLowerCase()
    if (est === 'cancelado') return false

    const prov = (c.Proveedor || c.proveedor || '').toLowerCase()
    const proy = (c.Proyecto || c.proyecto || '').toLowerCase()
    const proyId = (c.ProyectoID_Externo || c.proyectoID_Externo || '').toLowerCase()
    const cat = (c.Categoria || c.categoria || '').toLowerCase()
    const mat = (c.Material || c.material || '').toLowerCase()
    const prod = (c.Producto || c.producto || '').toLowerCase()
    const idStr = String(c.Numero ?? c.ID ?? c.Id ?? c.id ?? '')
    const fecha = String(c.FechaCompra || c.fechaCompra || c.Fecha || c.fecha || '').split('T')[0]

    const cumpleBusquedaRapida =
      !busquedaRapida ||
      prod.includes(busquedaRapida.toLowerCase()) ||
      prov.includes(busquedaRapida.toLowerCase()) ||
      mat.includes(busquedaRapida.toLowerCase()) ||
      idStr.includes(busquedaRapida)

    const cumpleProveedor = !filtroProveedor || prov === filtroProveedor.toLowerCase()
    const cumpleProyecto = !filtroProyecto || proy === filtroProyecto.toLowerCase()
    const cumpleProyectoId = !filtroProyectoId || proyId === filtroProyectoId.toLowerCase()
    const cumpleCategoria = !filtroCategoria || cat === filtroCategoria.toLowerCase()
    const cumpleMaterial = !filtroMaterial || mat === filtroMaterial.toLowerCase()
    const cumpleEstatus = !filtroEstatus || est === filtroEstatus.toLowerCase()

    let cumpleFecha = true
    if (filtroFechaInicio && fecha) cumpleFecha = cumpleFecha && fecha >= filtroFechaInicio
    if (filtroFechaFin && fecha) cumpleFecha = cumpleFecha && fecha <= filtroFechaFin

    return (
      cumpleBusquedaRapida &&
      cumpleProveedor &&
      cumpleProyecto &&
      cumpleProyectoId &&
      cumpleCategoria &&
      cumpleMaterial &&
      cumpleEstatus &&
      cumpleFecha
    )
  })

  const sumaCostoComprado = comprasFiltradas
    .filter((c) => String(c.Estatus || c.estatus || 'Comprado').toLowerCase() === 'comprado')
    .reduce((acc, curr) => acc + curr._subtotalCalculado, 0)

  const sumaCostoCompradoConIva = sumaCostoComprado * 1.16

  const limpiarFiltros = () => {
    setBusquedaRapida('')
    setFiltroProveedor('')
    setFiltroProyecto('')
    setFiltroProyectoId('')
    setFiltroCategoria('')
    setFiltroMaterial('')
    setFiltroEstatus('')
    setFiltroFechaInicio('')
    setFiltroFechaFin('')
  }

  const hayFiltrosActivos = Boolean(
    busquedaRapida ||
    filtroProveedor ||
    filtroProyecto ||
    filtroProyectoId ||
    filtroCategoria ||
    filtroMaterial ||
    filtroEstatus ||
    filtroFechaInicio ||
    filtroFechaFin
  )

  const columnasPrincipales = [
    { key: 'id_cotizacion', label: 'Folio', align: 'center' },
    { key: 'proveedor', label: 'Proveedor', align: 'left' },
    { key: 'fecha_compra', label: 'Fecha', align: 'center' },
    { key: 'producto', label: 'Producto / Servicio', align: 'left' },
    { key: 'material', label: 'Especificación / Material', align: 'left' },
    { key: 'subtotal', label: 'Subtotal', align: 'right' },
    { key: 'total_con_iva', label: 'Total c/ IVA', align: 'right' },
    { key: 'pdf', label: 'Archivo', align: 'center' },
    { key: 'estatus', label: 'Estatus', align: 'center' },
    ...(puedeEditar ? [{ key: 'acciones', label: '', align: 'right' }] : [])
  ]

  const renderizarCeldaPrincipal = (colKey, fila) => {
    switch (colKey) {
      case 'id_cotizacion': {
        const val = fila.Numero ?? fila.ID ?? fila.Id ?? fila.id ?? '—'
        return (
          <span className="pro-mono" style={estilos.badgeFolio}>
            #{val}
          </span>
        )
      }
      case 'proveedor':
        return (
          <div style={{ maxWidth: '280px', fontWeight: 600, color: '#1d1d1f' }}>
            {fila.Proveedor || fila.proveedor || '—'}
          </div>
        )
      case 'fecha_compra': {
        const f = String(fila.FechaCompra || fila.fechaCompra || fila.Fecha || fila.fecha || '').split('T')[0]
        const partes = f.split('-')
        return (
          <span className="pro-mono" style={{ color: '#515154', fontSize: '12px' }}>
            {partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : f || '—'}
          </span>
        )
      }
      case 'producto':
        return (
          <span style={estilos.pillProducto}>
            {fila.Producto || fila.producto || '—'}
          </span>
        )
      case 'material': {
        const mat = fila.Material || fila.material
        if (!mat) return <span style={{ color: '#d2d2d7' }}>—</span>
        return <span style={estilos.pillMaterial}>🛠️ {mat}</span>
      }
      case 'subtotal': {
        const val = fila._subtotalCalculado
        return (
          <span className="pro-mono" style={{ fontWeight: 600, color: '#1d1d1f' }}>
            ${val.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )
      }
      case 'total_con_iva': {
        const val = fila._totalConIvaCalculado
        return (
          <span className="pro-mono" style={estilos.pillMontoIva}>
            ${val.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )
      }
      case 'pdf': {
        const url = fila.URL_SaaS || fila.urlSaaS || fila.url_saas
        if (!url) return <span style={{ color: '#d2d2d7' }}>—</span>
        const esImagen = /\.(jpeg|jpg|gif|png|webp|svg)$/.test(String(url).split('?')[0].toLowerCase())
        return (
          <button
            type="button"
            onClick={() => setArchivoPrevisualizando({ url, esImagen, producto: fila.Producto || fila.producto })}
            className="pro-btn pro-btn-secondary pro-btn-sm"
            title="Abrir documento en el centro de la pantalla"
          >
            {esImagen ? '🖼️ Imagen' : '📄 Ver PDF'}
          </button>
        )
      }
      case 'estatus': {
        const est = fila.Estatus || fila.estatus || 'Comprado'
        const esComprado = String(est).toLowerCase() === 'comprado'
        return (
          <span
            className="pro-badge"
            style={{
              backgroundColor: esComprado ? 'var(--status-success-bg)' : 'var(--status-warning-bg)',
              color: esComprado ? 'var(--status-success-text)' : 'var(--status-warning-text)',
              border: `1px solid ${esComprado ? '#a7f3d0' : '#fde68a'}`
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: esComprado ? '#10b981' : '#f59e0b'
              }}
            />
            {est}
          </span>
        )
      }
      case 'acciones':
        return puedeEditar ? (
          <button
            type="button"
            onClick={() => iniciarEdicion(fila)}
            className="pro-btn pro-btn-secondary pro-btn-sm"
          >
            Editar
          </button>
        ) : null
      default:
        return '—'
    }
  }

  return (
    <div ref={contenedorRef} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* TARJETAS EJECUTIVAS DE INDICADORES (KPIs) */}
      <div style={estilos.gridKpis}>
        <div className="pro-card" style={{ padding: '18px 20px' }}>
          <div style={estilos.kpiHeader}>
            <span className="pro-label" style={{ margin: 0 }}>Filtro Directo de Proyecto</span>
            <span style={estilos.kpiIcon}>📁</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
            <select
              value={filtroProyecto}
              onChange={(e) => {
                setFiltroProyecto(e.target.value)
                if (e.target.value) setFiltroProyectoId('')
              }}
              className="pro-select"
              style={{ fontSize: '12.5px' }}
            >
              <option value="">Todos (Por Nombre)</option>
              {proyectosNombreUnicos.map((p, i) => (
                <option key={i} value={p}>{p}</option>
              ))}
            </select>

            <select
              value={filtroProyectoId}
              onChange={(e) => {
                setFiltroProyectoId(e.target.value)
                if (e.target.value) setFiltroProyecto('')
              }}
              className="pro-select pro-mono"
              style={{ fontSize: '12.5px', color: '#0071e3' }}
            >
              <option value="">Todos (Por ID Ext.)</option>
              {proyectoIdsUnicos.map((pid, i) => (
                <option key={i} value={pid}>{pid}</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: '11.5px', color: '#86868b', marginTop: '8px' }}>
            {filtroProyecto || filtroProyectoId
              ? `Filtrando: ${filtroProyecto || filtroProyectoId}`
              : 'Mostrando presupuesto global de la empresa'}
          </div>
        </div>

        <div className="pro-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={estilos.kpiHeader}>
            <span className="pro-label" style={{ margin: 0 }}>Operaciones Activas</span>
            <span style={estilos.kpiIcon}>📊</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.03em', color: '#1d1d1f' }}>
            {comprasFiltradas.length}
          </div>
          <div style={{ fontSize: '12px', color: '#86868b' }}>
            Registros visibles en consulta actual
          </div>
        </div>

        <div className="pro-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={estilos.kpiHeader}>
            <span className="pro-label" style={{ margin: 0, color: '#059669' }}>Inversión Ejercida (c/ IVA)</span>
            <span style={estilos.kpiIcon}>💳</span>
          </div>
          <div className="pro-mono" style={{ fontSize: '24px', fontWeight: 800, color: '#059669', letterSpacing: '-0.02em' }}>
            ${sumaCostoCompradoConIva.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="pro-mono" style={{ fontSize: '11.5px', color: '#86868b' }}>
            Subtotal s/ IVA: ${sumaCostoComprado.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS */}
      <div style={estilos.toolbar}>
        <div style={estilos.searchWrapper}>
          <span style={estilos.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Buscar por producto, proveedor, material o #folio..."
            value={busquedaRapida}
            onChange={(e) => setBusquedaRapida(e.target.value)}
            className="pro-input"
            style={{ paddingLeft: '36px', borderRadius: '10px' }}
          />
          {busquedaRapida && (
            <button onClick={() => setBusquedaRapida('')} style={estilos.clearSearchBtn}>
              ✕
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="pro-segmented">
            <button
              type="button"
              className={`pro-segmented-btn ${filtroEstatus === '' ? 'active' : ''}`}
              onClick={() => setFiltroEstatus('')}
            >
              Todos
            </button>
            <button
              type="button"
              className={`pro-segmented-btn ${filtroEstatus === 'Comprado' ? 'active' : ''}`}
              onClick={() => setFiltroEstatus('Comprado')}
            >
              🟢 Comprados
            </button>
            <button
              type="button"
              className={`pro-segmented-btn ${filtroEstatus === 'Cotizado' ? 'active' : ''}`}
              onClick={() => setFiltroEstatus('Cotizado')}
            >
              🟡 Cotizados
            </button>
          </div>

          {hayFiltrosActivos && (
            <button onClick={limpiarFiltros} className="pro-btn pro-btn-secondary">
              Restablecer
            </button>
          )}

          <button
            onClick={() => setMostrarFiltros(!mostrarFiltros)}
            className={`pro-btn ${mostrarFiltros ? 'pro-btn-dark' : 'pro-btn-secondary'}`}
          >
            <span>🎛️</span>
            <span>Filtros</span>
          </button>
        </div>
      </div>

      {/* PANEL DESPLEGABLE DE FILTROS AVANZADOS */}
      {mostrarFiltros && (
        <div className="pro-card animate-view" style={{ padding: '18px 20px' }}>
          <div style={estilos.gridFiltros}>
            <div>
              <label className="pro-label">Proveedor</label>
              <select value={filtroProveedor} onChange={(e) => setFiltroProveedor(e.target.value)} className="pro-select">
                <option value="">Todos los proveedores</option>
                {proveedoresUnicos.map((prov, i) => (
                  <option key={i} value={prov}>{prov}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="pro-label">Categoría</label>
              <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="pro-select">
                <option value="">Todas las categorías</option>
                {categoriasUnicas.map((cat, i) => (
                  <option key={i} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="pro-label">Material</label>
              <select value={filtroMaterial} onChange={(e) => setFiltroMaterial(e.target.value)} className="pro-select">
                <option value="">Todos los materiales</option>
                {materialesUnicos.map((mat, i) => (
                  <option key={i} value={mat}>{mat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="pro-label">Desde Fecha</label>
              <input
                type="date"
                value={filtroFechaInicio}
                onChange={(e) => setFiltroFechaInicio(e.target.value)}
                className="pro-input"
              />
            </div>

            <div>
              <label className="pro-label">Hasta Fecha</label>
              <input
                type="date"
                value={filtroFechaFin}
                onChange={(e) => setFiltroFechaFin(e.target.value)}
                className="pro-input"
              />
            </div>
          </div>
        </div>
      )}

      {/* TABLA PRINCIPAL DE TRANSACCIONES */}
      <div className="pro-table-container">
        <table className="pro-table">
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }} />
              {columnasPrincipales.map((col) => (
                <th key={col.key} style={{ textAlign: col.align }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comprasFiltradas.length === 0 ? (
              <tr>
                <td colSpan={columnasPrincipales.length + 1} style={{ padding: '48px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>📭</div>
                  <div style={{ fontWeight: 600, color: '#1d1d1f' }}>No se encontraron registros</div>
                  <div style={{ fontSize: '12.5px', color: '#86868b', marginTop: '4px' }}>
                    Prueba ajustando los criterios de búsqueda.
                  </div>
                </td>
              </tr>
            ) : (
              comprasFiltradas.map((fila, index) => {
                const idFila = fila.Numero ?? fila.ID ?? fila.Id ?? index
                const estaAbierto = !!filasExpandidas[idFila]
                const estAlmacen = fila.EstatusAlmacen || fila.estatusAlmacen || 'Pendiente'
                const esRecibido = String(estAlmacen).toLowerCase().includes('recibido')

                return (
                  <React.Fragment key={idFila}>
                    <tr>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => toggleFilaExpandida(idFila)}
                          style={estilos.btnExpandir(estaAbierto)}
                          title="Ver detalles técnicos"
                        >
                          ▶
                        </button>
                      </td>
                      {columnasPrincipales.map((col) => (
                        <td key={col.key} style={{ textAlign: col.align }}>
                          {renderizarCeldaPrincipal(col.key, fila)}
                        </td>
                      ))}
                    </tr>

                    {estaAbierto && (
                      <tr style={{ backgroundColor: '#f8fafc' }}>
                        <td colSpan={columnasPrincipales.length + 1} style={{ padding: '16px 24px' }}>
                          <div style={estilos.panelDetalleExpandido}>
                            <div>
                              <span className="pro-label">Proyecto ID</span>
                              <span className="pro-mono" style={{ fontWeight: 700, color: '#0071e3' }}>
                                {fila.ProyectoID_Externo || fila.proyectoID_Externo || '—'}
                              </span>
                            </div>
                            <div>
                              <span className="pro-label">Nombre Proyecto</span>
                              <span style={{ fontWeight: 600 }}>
                                {fila.Proyecto || fila.proyecto || 'Sin asignar'}
                              </span>
                            </div>
                            <div>
                              <span className="pro-label">Categoría</span>
                              <span>{fila.Categoria || fila.categoria || '—'}</span>
                            </div>
                            <div>
                              <span className="pro-label">Precio Unitario</span>
                              <span className="pro-mono">
                                ${Number(fila.PrecioUnitario || fila.precioUnitario || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div>
                              <span className="pro-label">Cantidad</span>
                              <span className="pro-mono" style={{ fontWeight: 700 }}>
                                {fila.Cantidad || fila.cantidad || 1} u.
                              </span>
                            </div>
                            <div>
                              <span className="pro-label">Recepción Almacén</span>
                              <span
                                className="pro-badge"
                                style={{
                                  backgroundColor: esRecibido ? '#ecfdf5' : '#fffbeb',
                                  color: esRecibido ? '#065f46' : '#92400e'
                                }}
                              >
                                {esRecibido ? '📥 Recibido en Almacén' : '⏳ Pendiente'}
                              </span>
                            </div>
                            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span className="pro-label">Notas / Observaciones</span>
                                <span style={{ color: '#515154', fontStyle: 'italic' }}>
                                  {fila.Notas || fila.notas || 'Sin observaciones adicionales.'}
                                </span>
                              </div>
                              {puedeEditar && (
                                <button onClick={() => iniciarEdicion(fila)} className="pro-btn pro-btn-primary pro-btn-sm">
                                  ✏️ Modificar Registro
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* PORTAL DIRECTO AL BODY: Garantiza centrado perfecto en pantalla aunque haya miles de filas */}
      {archivoPrevisualizando &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setArchivoPrevisualizando(null)}>
            <div
              className="pro-modal-window"
              style={{ maxWidth: '940px', height: '86vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pro-modal-header">
                <div>
                  <h3 style={{ fontSize: '15px', margin: 0 }}>
                    📄 {archivoPrevisualizando.producto || 'Documento Adjunto'}
                  </h3>
                  <span style={{ fontSize: '11.5px', color: '#86868b' }}>
                    Visor Centrado de Azure Blob Storage
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a
                    href={archivoPrevisualizando.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pro-btn pro-btn-primary pro-btn-sm"
                  >
                    ↗ Abrir en pestaña completa
                  </a>
                  <button
                    onClick={() => setArchivoPrevisualizando(null)}
                    className="pro-btn pro-btn-secondary pro-btn-sm"
                  >
                    ✕ Cerrar
                  </button>
                </div>
              </div>
              <div
                className="pro-modal-body"
                style={{
                  flex: 1,
                  padding: 0,
                  backgroundColor: '#1d1d1f',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden'
                }}
              >
                {archivoPrevisualizando.esImagen ? (
                  <img
                    src={archivoPrevisualizando.url}
                    alt="Vista previa"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <iframe
                    src={archivoPrevisualizando.url}
                    title="Visor PDF"
                    style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

const estilos = {
  gridKpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
    gap: '16px'
  },
  kpiHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  kpiIcon: {
    fontSize: '18px'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap'
  },
  searchWrapper: {
    position: 'relative',
    flex: 1,
    minWidth: '260px'
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '13px',
    pointerEvents: 'none'
  },
  clearSearchBtn: {
    position: 'absolute',
    right: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    border: 'none',
    background: 'none',
    color: '#86868b',
    cursor: 'pointer'
  },
  gridFiltros: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '14px'
  },
  badgeFolio: {
    backgroundColor: '#f1f5f9',
    color: '#334155',
    padding: '3px 8px',
    borderRadius: '6px',
    fontWeight: 700,
    fontSize: '12px'
  },
  pillProducto: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    color: '#1d1d1f',
    padding: '4px 9px',
    borderRadius: '6px',
    fontSize: '12.5px',
    fontWeight: 500,
    display: 'inline-block'
  },
  pillMaterial: {
    backgroundColor: '#f5f3ff',
    border: '1px solid #ddd6fe',
    color: '#6d28d9',
    padding: '3.5px 8px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    display: 'inline-block'
  },
  pillMontoIva: {
    backgroundColor: '#ecfdf5',
    border: '1px solid #a7f3d0',
    color: '#047857',
    padding: '4px 9px',
    borderRadius: '7px',
    fontWeight: 700,
    fontSize: '13px'
  },
  btnExpandir: (abierto) => ({
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#86868b',
    fontSize: '10px',
    transform: abierto ? 'rotate(90deg)' : 'rotate(0deg)',
    transition: 'transform 0.2s ease',
    padding: '6px'
  }),
  panelDetalleExpandido: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '14px',
    backgroundColor: '#ffffff',
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid var(--border-light)'
  }
}