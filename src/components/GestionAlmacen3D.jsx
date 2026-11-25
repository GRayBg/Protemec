import { useState, Suspense, useMemo, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Html, Bounds } from '@react-three/drei'
import { Almacen3D } from './Almacen3D'

export default function GestionAlmacen3D({
  API_URL,
  ubicacionResaltada = null,
  productoResaltado = null,
  esModal = false,
  syncTrigger = 0
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const claveExterna = `${productoResaltado?.ID ?? productoResaltado?.id ?? ''}_${ubicacionResaltada ?? ''}`
  const [seleccionUsuario, setSeleccionUsuario] = useState({ clave: '', definida: false, item: null })
  const [inventarioRemoto, setInventarioRemoto] = useState([])
  const [cargando, setCargando] = useState(() => Boolean(API_URL))
  const [error, setError] = useState(null)

  const itemSeleccionadoRef = useRef(null)

  // OBTENER PRODUCTOS DESDE LA BASE DE DATOS (Se actualiza también con el botón Sincronizar)
  useEffect(() => {
    if (!API_URL) return

    const controller = new AbortController()

    const cargarInventario = async () => {
      try {
        const respuesta = await fetch(
          `${API_URL}/api/inventario?t=${Date.now()}`,
          { signal: controller.signal }
        )

        if (!respuesta.ok) {
          throw new Error('No se pudo obtener el inventario')
        }

        const data = await respuesta.json()

        if (!Array.isArray(data)) {
          throw new Error('Formato de inventario inválido')
        }

        const productos = data.map((i) => ({
          id: `db-${i.ID}`,
          rawId: i.ID,
          nombre: i.NombreProducto,
          ubicacion: i.Ubicacion3D,
          stock: i.CantidadStock
        }))

        setInventarioRemoto(productos)
        setError(null)
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Error cargando inventario:', err)
          setError('No se pudo cargar el inventario.')
          setInventarioRemoto([])
        }
      } finally {
        if (!controller.signal.aborted) {
          setCargando(false)
        }
      }
    }

    cargarInventario()

    return () => controller.abort()
  }, [API_URL, syncTrigger])

  // ARTÍCULO DESTACADO DESDE VENTANA FLOTANTE DEL STOCK (SIN EFECTOS CASCADA)
  const productoDestacadoExterno = useMemo(() => {
    if (inventarioRemoto.length === 0) return null

    if (productoResaltado) {
      const idBuscado = productoResaltado.ID ?? productoResaltado.id
      const nombreBuscado = String(
        productoResaltado.NombreProducto ?? productoResaltado.nombre ?? ''
      ).toLowerCase()

      const encontrado = inventarioRemoto.find(
        (p) =>
          (idBuscado !== undefined &&
            (p.id === `db-${idBuscado}` || String(p.rawId) === String(idBuscado))) ||
          (nombreBuscado && String(p.nombre ?? '').toLowerCase() === nombreBuscado)
      )

      if (encontrado) return encontrado
    }

    if (ubicacionResaltada) {
      const ubLwr = String(ubicacionResaltada).toLowerCase()
      return (
        inventarioRemoto.find(
          (p) => String(p.ubicacion ?? '').toLowerCase() === ubLwr
        ) ?? null
      )
    }

    return null
  }, [productoResaltado, ubicacionResaltada, inventarioRemoto])

  // FILTRAR PRODUCTOS DE LA BASE DE DATOS
  const productosFiltrados = useMemo(() => {
    if (!searchTerm.trim()) return inventarioRemoto

    const term = searchTerm.trim().toLowerCase()

    return inventarioRemoto.filter(
      (p) =>
        String(p.nombre ?? '').toLowerCase().includes(term) ||
        String(p.ubicacion ?? '').toLowerCase().includes(term)
    )
  }, [searchTerm, inventarioRemoto])

  // MANTENER SINCRONIZADA LA SELECCIÓN
  const productoActivo = useMemo(() => {
    const base =
      seleccionUsuario.definida && seleccionUsuario.clave === claveExterna
        ? seleccionUsuario.item
        : productoDestacadoExterno

    if (!base) return null
    return inventarioRemoto.find((p) => p.id === base.id) ?? null
  }, [seleccionUsuario, claveExterna, productoDestacadoExterno, inventarioRemoto])

  const seleccionarProducto = (nuevoItem) => {
    setSeleccionUsuario({ clave: claveExterna, definida: true, item: nuevoItem })
  }

  // Hacer scroll suave en la lista izquierda hacia el producto seleccionado
  useEffect(() => {
    if (productoActivo && itemSeleccionadoRef.current) {
      itemSeleccionadoRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }, [productoActivo])

  // UBICACIONES QUE SE ILUMINARÁN EN EL MODELO 3D
  const ubicacionesAColorear = useMemo(() => {
    if (productoActivo) {
      return productoActivo.ubicacion ? [productoActivo.ubicacion] : []
    }

    if (searchTerm.trim()) {
      return [
        ...new Set(
          productosFiltrados.map((p) => p.ubicacion).filter(Boolean)
        )
      ]
    }

    if (ubicacionResaltada) {
      return [ubicacionResaltada]
    }

    return []
  }, [productosFiltrados, productoActivo, searchTerm, ubicacionResaltada])

  return (
    <div
      className="pro-card"
      style={estilos.contenedorPrincipal(esModal)}
    >
      {/* PANEL LATERAL DE BÚSQUEDA (Único con barra de desplazamiento) */}
      <div style={estilos.panelLateral}>
        <div style={{ marginBottom: '14px', flexShrink: 0 }}>
          <h3 style={{ fontSize: '15px', marginBottom: '4px' }}>
            📦 Gemelo Digital 3D
          </h3>
          <p style={{ fontSize: '12px', color: '#86868b', margin: 0 }}>
            Selecciona un material para iluminar su ubicación física en el almacén
          </p>
        </div>

        {/* BUSCADOR */}
        <input
          type="text"
          placeholder="🔍 Buscar material o código (Ej. Pieza4)..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            seleccionarProducto(null)
          }}
          className="pro-input"
          style={{ marginBottom: '12px', flexShrink: 0 }}
        />

        {/* CONTADOR Y LIMPIAR SELECCIÓN */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
            flexShrink: 0
          }}
        >
          <span className="pro-label" style={{ margin: 0 }}>
            Elementos ({productosFiltrados.length})
          </span>

          {productoActivo && (
            <button
              type="button"
              onClick={() => seleccionarProducto(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#0071e3',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Limpiar selección
            </button>
          )}
        </div>

        {/* LISTA DE PRODUCTOS */}
        <ul style={estilos.listaResultados}>
          {cargando && (
            <li style={estilos.mensajeLista}>Cargando inventario...</li>
          )}

          {!cargando && error && (
            <li style={{ ...estilos.mensajeLista, color: '#dc2626' }}>
              {error}
            </li>
          )}

          {!cargando && !error && productosFiltrados.length === 0 && (
            <li style={estilos.mensajeLista}>
              {searchTerm.trim()
                ? 'No se encontraron materiales.'
                : 'No hay productos registrados en el inventario.'}
            </li>
          )}

          {!cargando &&
            !error &&
            productosFiltrados.map((item) => {
              const isSelected = productoActivo?.id === item.id

              return (
                <li
                  key={item.id}
                  ref={isSelected ? itemSeleccionadoRef : null}
                  onClick={() =>
                    seleccionarProducto(isSelected ? null : item)
                  }
                  style={estilos.itemLista(isSelected)}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <strong
                      style={{
                        fontSize: '13px',
                        color: isSelected ? '#0071e3' : '#1d1d1f'
                      }}
                    >
                      {item.nombre}
                    </strong>

                    {item.stock !== undefined && item.stock !== null && (
                      <span
                        className="pro-mono"
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#515154'
                        }}
                      >
                        {item.stock} u.
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: '11.5px',
                      color: '#86868b',
                      marginTop: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>Nodo 3D:</span>
                    <code
                      className="pro-mono"
                      style={estilos.codeTag(isSelected)}
                    >
                      {item.ubicacion || 'Sin ubicación'}
                    </code>
                  </div>
                </li>
              )
            })}
        </ul>
      </div>

      {/* VISOR 3D (Sin barra de scroll y siempre centrado) */}
      <div style={estilos.visorCanvas}>
        {productoActivo && (
          <div style={estilos.hudBanner}>
            <span>📍 Ubicación seleccionada:</span>
            <strong className="pro-mono">
              {productoActivo.ubicacion || 'Sin ubicación'}
            </strong>
            <span>— {productoActivo.nombre}</span>
          </div>
        )}

        <Canvas
          style={{ width: '100%', height: '100%', display: 'block' }}
          camera={{
            position: [5, 5, 5],
            fov: 40
          }}
        >
          <color attach="background" args={['#f8fafc']} />
          <ambientLight intensity={1.3} />
          <directionalLight position={[10, 15, 10]} intensity={1.8} />

          <Suspense
            fallback={
              <Html center>
                <div
                  style={{
                    background: '#1d1d1f',
                    color: '#fff',
                    padding: '10px 18px',
                    borderRadius: '99px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}
                >
                  Cargando Gemelo Digital 3D...
                </div>
              </Html>
            }
          >
            <Bounds fit clip observe margin={1.2}>
              <Almacen3D ubicacionesDestacadas={ubicacionesAColorear} />
            </Bounds>
          </Suspense>

          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </div>
  )
}

// ESTILOS
const estilos = {
  contenedorPrincipal: (esModal) => ({
    display: 'flex',
    width: '100%',
    height: esModal ? '100%' : 'calc(100vh - 130px)',
    minHeight: esModal ? '0px' : '460px',
    overflow: 'hidden',
    boxSizing: 'border-box'
  }),

  panelLateral: {
    width: '330px',
    height: '100%',
    padding: '20px',
    backgroundColor: '#ffffff',
    borderRight: '1px solid var(--border-light)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    overflow: 'hidden'
  },

  listaResultados: {
    listStyle: 'none',
    padding: '0 4px 0 0',
    margin: 0,
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },

  mensajeLista: {
    padding: '16px',
    fontSize: '12px',
    color: '#86868b',
    textAlign: 'center'
  },

  itemLista: (isSelected) => ({
    padding: '11px 14px',
    borderRadius: '10px',
    border: `1px solid ${isSelected ? '#0071e3' : 'var(--border-light)'}`,
    backgroundColor: isSelected ? 'rgba(0, 113, 227, 0.06)' : '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    flexShrink: 0
  }),

  codeTag: (isSelected) => ({
    backgroundColor: isSelected ? '#0071e3' : '#f1f5f9',
    color: isSelected ? '#ffffff' : '#334155',
    padding: '2px 6px',
    borderRadius: '5px',
    fontSize: '11px',
    fontWeight: 600
  }),

  visorCanvas: {
    flex: 1,
    height: '100%',
    position: 'relative',
    backgroundColor: '#f8fafc',
    overflow: 'hidden'
  },

  hudBanner: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    zIndex: 10,
    backgroundColor: 'rgba(29, 29, 31, 0.86)',
    backdropFilter: 'blur(10px)',
    color: '#ffffff',
    padding: '8px 16px',
    borderRadius: '999px',
    fontSize: '12.5px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 8px 20px rgba(0,0,0,0.15)'
  }
}