import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import VistaConsulta from './components/VistaConsulta'
import FormularioCompra from './components/FormularioCompra'
import GestionClientes from './components/GestionClientes'
import GestionProyectos from './components/GestionProyectos'
import GestionIngenieria from './components/GestionIngenieria'
import GestionKanban from './components/GestionKanban'
import GestionAlmacenInventario from './components/GestionAlmacenInventario'
import GestionAlmacen3D from './components/GestionAlmacen3D'
import GestionRH from './components/GestionRH'
import GestionGerencia from './components/GestionGerencia'
import GestionChatbot from './components/GestionChatbot'
import ModalConfiguracion from './components/ModalConfiguracion'

//const API_URL = import.meta.env.VITE_API_URL
const API_URL = import.meta.env.VITE_API_URL || 'https://pruebajs-ezbja7gjf9cmg4fn.centralus-01.azurewebsites.net'

const PERFIL_MAESTRO_TOTAL = {
  id: 1,
  nombre: 'Dirección / Perfil Maestro',
  usuario: 'admin',
  email: 'admin@protemec.com',
  rol: 'SuperAdmin',
  esMaestro: true,
  permisos: {
    gerencia: { ver: true, editar: true },
    compras: { ver: true, editar: true },
    proyectos: { ver: true, editar: true },
    clientes: { ver: true, editar: true },
    ingenieria: { ver: true, editar: true },
    kanban: { ver: true, editar: true },
    almacen: { ver: true, editar: true },
    rh: { ver: true, editar: true },
    chatbot: { ver: true, editar: true },
    seguridad: { ver: true, editar: true }
  }
}

// Determina si el texto de un botón corresponde a una acción de Consulta/Lectura permitida
function esBotonDeSoloConsulta(texto = '', clase = '') {
  if (clase.includes('pro-segmented-btn') && !texto.includes('registrar') && !texto.includes('nuevo')) {
    return true
  }
  const t = texto.trim().toLowerCase()
  if (!t || t === '▶' || t === '▼' || t === '«' || t === '»' || t === '✕' || t === '×') return true

  const palabrasPermitidas = [
    'ver ',
    'ver pdf',
    'ver archivo',
    'archivos',
    'kpis',
    'perfil kpi',
    'abrir',
    'descargar',
    'cerrar',
    'listo',
    'sincronizar',
    'sincronizando',
    'todos',
    'comprados',
    'cotizados',
    'filtros',
    'limpiar',
    'activos',
    'bajas',
    'explorador 3d',
    'control de avance',
    'tablero kanban',
    'salidas de almacén',
    'recepción y stock',
    'gemelo digital 3d',
    'gemelo 3d',
    'existencias',
    'préstamos',
    'recepción',
    'historial',
    'plantilla',
    'panel principal',
    'envío en grupo',
    'kardex',
    'ubicar en 3d',
    'ver en 3d',
    'cerrar vista flotante'
  ]
  return palabrasPermitidas.some((p) => t.includes(p))
}

// Determina si el texto de un botón corresponde a una acción de Creación/Edición/Baja
function esBotonDeEscritura(texto = '', titulo = '', tipo = '') {
  if (tipo === 'submit') return true
  const combinado = `${texto} ${titulo}`.trim().toLowerCase()
  if (combinado === '+' || combinado === '-' || combinado === '＋' || combinado === '🗑️' || combinado === '✏️') {
    return true
  }

  const palabrasEscritura = [
    'editar',
    'guardar',
    'registrar',
    'nuevo',
    'nueva',
    'crear',
    'añadir',
    'agregar',
    'dar de alta',
    'eliminar',
    'borrar',
    'cancelar registro',
    'subir',
    'cambiar foto',
    'sumar stock',
    'prestar',
    'dar salida',
    'dar entrada',
    'recibir devolución',
    'recibir pieza',
    'recibir todo el kit',
    'autorizar',
    'confirmar',
    'modificar',
    'actualizar'
  ]
  return palabrasEscritura.some((p) => combinado.includes(p))
}

export default function App() {
  // Estados de Seguridad, Perfiles y Credenciales Maestras desde Azure SQL
  const [perfilesUsuarios, setPerfilesUsuarios] = useState([])
  const [credencialesMaestras, setCredencialesMaestras] = useState({
    id: 1,
    nombre: 'Dirección / Perfil Maestro',
    usuario: 'admin',
    password: '',
    email: 'admin@protemec.com',
    rol: 'SuperAdmin',
    permisos: PERFIL_MAESTRO_TOTAL.permisos
  })

  const [usuarioActual, setUsuarioActual] = useState(() => {
    try {
      const sesion = localStorage.getItem('protemec_sesion_activa')
      return sesion ? JSON.parse(sesion) : null
    } catch {
      return null
    }
  })

  // Estados de la Pantalla de Login
  const [modoLogin, setModoLogin] = useState('maestro') // 'entra' | 'maestro'
  const [emailEntraInput, setEmailEntraInput] = useState('')
  const [userMaestroInput, setUserMaestroInput] = useState('')
  const [passMaestroInput, setPassMaestroInput] = useState('')
  const [errorLogin, setErrorLogin] = useState('')
  const [validandoLogin, setValidandoLogin] = useState(false)

  // Sincronizar permisos en vivo desde Azure SQL para la sesión actual
  const usuarioConPermisosActualizados = useMemo(() => {
    if (!usuarioActual) return null
    if (usuarioActual.esMaestro) {
      return {
        ...PERFIL_MAESTRO_TOTAL,
        id: credencialesMaestras.id || usuarioActual.id,
        nombre: credencialesMaestras.nombre || PERFIL_MAESTRO_TOTAL.nombre,
        usuario: credencialesMaestras.usuario || PERFIL_MAESTRO_TOTAL.usuario,
        email: credencialesMaestras.email || PERFIL_MAESTRO_TOTAL.email
      }
    }
    const perfilBD = perfilesUsuarios.find(
      (p) =>
        String(p.id) === String(usuarioActual.id) ||
        (p.usuario &&
          usuarioActual.usuario &&
          String(p.usuario).toLowerCase() === String(usuarioActual.usuario).toLowerCase())
    )
    return perfilBD || usuarioActual
  }, [usuarioActual, perfilesUsuarios, credencialesMaestras])

  // Mantener localStorage siempre sincronizado con los permisos más recientes de Azure SQL
  useEffect(() => {
    if (usuarioConPermisosActualizados) {
      localStorage.setItem('protemec_sesion_activa', JSON.stringify(usuarioConPermisosActualizados))
    } else {
      localStorage.removeItem('protemec_sesion_activa')
    }
  }, [usuarioConPermisosActualizados])

  // Verificar si el usuario actual puede ver o editar el panel de Seguridad
  const puedeVerSeguridad = Boolean(
    usuarioConPermisosActualizados?.esMaestro ||
    usuarioConPermisosActualizados?.permisos?.seguridad?.ver === true
  )

  const puedeDarPermisos = Boolean(
    usuarioConPermisosActualizados?.esMaestro ||
    usuarioConPermisosActualizados?.permisos?.seguridad?.editar === true
  )

  // Navegación Principal
  const [moduloActivo, setModuloActivo] = useState('compras')
  const [sidebarColapsado, setSidebarColapsado] = useState(() => window.innerWidth < 1280)
  const [subVistaIngenieria, setSubVistaIngenieria] = useState('explorador')
  const [subVistaAlmacen, setSubVistaAlmacen] = useState('inventario')

  // Estados de Datos Globales (Azure SQL) + Trigger de Sincronización Global
  const [compras, setCompras] = useState([])
  const [clientes, setClientes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [contactos, setContactos] = useState([])
  const [proyectos, setProyectos] = useState([])
  const [disenos, setDisenos] = useState([])
  const [personalRH, setPersonalRH] = useState([])
  const [evaluacionesKPI, setEvaluacionesKPI] = useState([])
  const [movimientosAlmacen, setMovimientosAlmacen] = useState([])
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [syncTrigger, setSyncTrigger] = useState(0)

  // Ventanas Emergentes (Modales)
  const [modalCompraAbierto, setModalCompraAbierto] = useState(false)
  const [modalConfigAbierto, setModalConfigAbierto] = useState(false)
  const [confirmacionModal, setConfirmacionModal] = useState(null)

  // Notificaciones tipo Apple Dynamic Island
  const [notificacion, setNotificacion] = useState(null)

  const mostrarToast = useCallback((mensaje, tipo = 'exito') => {
    setNotificacion({ mensaje, tipo })
    setTimeout(() => {
      setNotificacion((actual) => (actual?.mensaje === mensaje ? null : actual))
    }, 3600)
  }, [])

  // Permisos estrictos del módulo activo
  const permisosModuloActual = usuarioConPermisosActualizados?.permisos?.[moduloActivo] || {
    ver: false,
    editar: false
  }
  const puedeEditarModuloActual = Boolean(
    usuarioConPermisosActualizados?.esMaestro || permisosModuloActual.editar === true
  )

  useEffect(() => {
    if (moduloActivo === 'ingenieria' && !puedeEditarModuloActual && subVistaIngenieria === 'nuevo') {
      setSubVistaIngenieria('explorador')
    }
  }, [moduloActivo, puedeEditarModuloActual, subVistaIngenieria])

  useEffect(() => {
    if (!usuarioConPermisosActualizados || usuarioConPermisosActualizados.esMaestro) return
    const puedeVerActual = usuarioConPermisosActualizados.permisos?.[moduloActivo]?.ver === true
    if (!puedeVerActual) {
      const primeroAutorizado = [
        'gerencia',
        'compras',
        'proyectos',
        'clientes',
        'ingenieria',
        'kanban',
        'almacen',
        'rh',
        'chatbot'
      ].find((k) => usuarioConPermisosActualizados.permisos?.[k]?.ver === true)
      if (primeroAutorizado) setModuloActivo(primeroAutorizado)
    }
  }, [usuarioConPermisosActualizados, moduloActivo])

  // CANDADO 1: Interceptor Global de Fetch para impedir POST/PUT/DELETE si no tiene permiso de edición
  const permisosRef = useRef(usuarioConPermisosActualizados)
  const moduloRef = useRef(moduloActivo)
  useEffect(() => {
    permisosRef.current = usuarioConPermisosActualizados
    moduloRef.current = moduloActivo
  }, [usuarioConPermisosActualizados, moduloActivo])

  useEffect(() => {
    const fetchOriginal = window.fetch.bind(window)

    window.fetch = async (input, init = {}) => {
      const metodo = (init?.method || 'GET').toUpperCase()
      const urlStr = typeof input === 'string' ? input : input?.url || ''

      if (['POST', 'PUT', 'DELETE'].includes(metodo) && !urlStr.includes('/api/login')) {
        const user = permisosRef.current
        if (user && !user.esMaestro) {
          let moduloRequerido = moduloRef.current
          if (urlStr.includes('/api/compras') || urlStr.includes('/api/datos')) moduloRequerido = 'compras'
          else if (urlStr.includes('/api/proyectos')) moduloRequerido = 'proyectos'
          else if (
            urlStr.includes('/api/clientes') ||
            urlStr.includes('/api/ubicaciones') ||
            urlStr.includes('/api/contactos')
          )
            moduloRequerido = 'clientes'
          else if (urlStr.includes('/api/ingenieria')) moduloRequerido = moduloRef.current === 'kanban' ? 'kanban' : 'ingenieria'
          else if (urlStr.includes('/api/inventario')) moduloRequerido = 'almacen'
          else if (urlStr.includes('/api/rh')) moduloRequerido = 'rh'
          else if (urlStr.includes('/api/usuarios')) moduloRequerido = 'seguridad'

          const tienePermisoEdicion = Boolean(
            user.permisos?.[moduloRequerido]?.editar === true ||
            (moduloRequerido === 'ingenieria' && moduloRef.current === 'kanban' && user.permisos?.kanban?.editar === true) ||
            (moduloRequerido === 'kanban' && user.permisos?.ingenieria?.editar === true)
          )
          if (!tienePermisoEdicion) {
            mostrarToast('🔒 Modo Solo Lectura: No tienes permisos para guardar ni modificar datos', 'alerta')
            return new Response(
              JSON.stringify({ error: 'Modo Solo Lectura: Permiso de edición denegado' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            )
          }
        }
      }

      return fetchOriginal(input, init)
    }

    return () => {
      window.fetch = fetchOriginal
    }
  }, [mostrarToast])

  // CANDADO 2: Bloqueo Visual Automático de Formularios de Alta y Botones de Edición en el DOM
  const mainContentRef = useRef(null)

  useEffect(() => {
    const contenedor = mainContentRef.current
    if (!contenedor) return

    const aplicarCandadoDOM = () => {
      if (puedeEditarModuloActual) {
        contenedor.querySelectorAll('[data-bloqueado-lectura="true"]').forEach((el) => {
          el.style.display = ''
          el.disabled = false
          el.removeAttribute('data-bloqueado-lectura')
        })
        return
      }

      if (moduloActivo !== 'chatbot') {
        contenedor.querySelectorAll('form').forEach((formEl) => {
          if (formEl.getAttribute('data-bloqueado-lectura') !== 'true') {
            formEl.style.display = 'none'
            formEl.setAttribute('data-bloqueado-lectura', 'true')
          }
        })
      }

      contenedor.querySelectorAll('button, label.pro-btn').forEach((btn) => {
        const texto = btn.textContent || ''
        const titulo = btn.getAttribute('title') || ''
        const tipo = (btn.getAttribute('type') || '').toLowerCase()
        const clase = btn.className || ''

        if (esBotonDeSoloConsulta(texto, clase)) return

        if (esBotonDeEscritura(texto, titulo, tipo)) {
          btn.style.display = 'none'
          btn.disabled = true
          btn.setAttribute('data-bloqueado-lectura', 'true')
        }
      })

      contenedor
        .querySelectorAll('input[type="file"], input[type="range"], input[type="checkbox"], input[type="date"]')
        .forEach((inp) => {
          inp.disabled = true
          inp.setAttribute('data-bloqueado-lectura', 'true')
        })
    }

    aplicarCandadoDOM()

    const observer = new MutationObserver(() => {
      aplicarCandadoDOM()
    })

    observer.observe(contenedor, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [puedeEditarModuloActual, moduloActivo, compras, proyectos, clientes, ubicaciones, contactos, disenos, personalRH])

  // Estados del Formulario de Compras
  const [idEditando, setIdEditando] = useState(null)
  const [proveedor, setProveedor] = useState('')
  const [costo, setCosto] = useState('')
  const [categoria, setCategoria] = useState('')
  const [producto, setProducto] = useState('')
  const [proyecto, setProyecto] = useState('')
  const [proyectoIdExterno, setProyectoIdExterno] = useState('')
  const [precioUnitario, setPrecioUnitario] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [fechaCompra, setFechaCompra] = useState('')
  const [estatus, setEstatus] = useState('Comprado')
  const [material, setMaterial] = useState('')
  const [notas, setNotas] = useState('')
  const [urlSaaS, setUrlSaaS] = useState('')
  const [archivoSeleccionado, setArchivoSeleccionado] = useState(null)
  const [guardando, setGuardando] = useState(false)

  // FUNCIÓN GLOBAL DE SINCRONIZACIÓN PARA TODOS LOS MÓDULOS DEL ERP
  const recargarDatos = useCallback(async (silencioso = false) => {
    if (!silencioso) setSincronizando(true)
    setSyncTrigger((prev) => prev + 1) // <-- Fuerza actualización en módulos con estado interno (Almacén y Visor 3D)
    const ts = Date.now()

    const fetchSeguro = async (endpoint) => {
      try {
        const res = await fetch(`${API_URL}${endpoint}?t=${ts}`, { cache: 'no-store' })
        if (!res.ok) return null
        return await res.json()
      } catch {
        return null
      }
    }

    const [
      datosCompras,
      datosClientes,
      datosUbicaciones,
      datosContactos,
      datosProyectos,
      datosIngenieria,
      datosUsuarios,
      datosPersonalRH,
      datosKpis,
      datosMovimientos
    ] = await Promise.all([
      fetchSeguro('/api/datos'),
      fetchSeguro('/api/clientes'),
      fetchSeguro('/api/ubicaciones'),
      fetchSeguro('/api/contactos'),
      fetchSeguro('/api/proyectos'),
      fetchSeguro('/api/ingenieria'),
      fetchSeguro('/api/usuarios'),
      fetchSeguro('/api/rh/personal'),
      fetchSeguro('/api/rh/kpis'),
      fetchSeguro('/api/inventario/movimientos')
    ])

    if (Array.isArray(datosCompras)) setCompras(datosCompras)
    if (Array.isArray(datosClientes)) setClientes(datosClientes)
    if (Array.isArray(datosUbicaciones)) setUbicaciones(datosUbicaciones)
    if (Array.isArray(datosContactos)) setContactos(datosContactos)
    if (Array.isArray(datosProyectos)) setProyectos(datosProyectos)
    if (Array.isArray(datosIngenieria)) setDisenos(datosIngenieria)
    if (Array.isArray(datosPersonalRH)) setPersonalRH(datosPersonalRH)
    if (Array.isArray(datosKpis)) setEvaluacionesKPI(datosKpis)
    if (Array.isArray(datosMovimientos)) setMovimientosAlmacen(datosMovimientos)

    if (Array.isArray(datosUsuarios)) {
      const adminDB = datosUsuarios.find((u) => u.esMaestro)
      if (adminDB) {
        setCredencialesMaestras(adminDB)
      }
      setPerfilesUsuarios(datosUsuarios.filter((u) => !u.esMaestro))
    }

    setCargando(false)
    setSincronizando(false)

    if (!silencioso) {
      mostrarToast('Datos sincronizados con Azure SQL')
    }
  }, [mostrarToast])

  useEffect(() => {
    recargarDatos(true)
  }, [recargarDatos])

  const proveedoresUnicos = useMemo(
    () => [...new Set(compras.map((c) => c.Proveedor || c.proveedor).filter(Boolean))],
    [compras]
  )
  const categoriasUnicas = useMemo(
    () => [...new Set(compras.map((c) => c.Categoria || c.categoria).filter(Boolean))],
    [compras]
  )
  const productosUnicos = useMemo(
    () => [...new Set(compras.map((c) => c.Producto || c.producto).filter(Boolean))],
    [compras]
  )
  const materialesUnicos = useMemo(
    () => [...new Set(compras.map((c) => c.Material || c.material).filter(Boolean))],
    [compras]
  )
  const proyectosUnicos = useMemo(() => {
    const deTablaProyectos = proyectos.map((p) => p.NombreProyecto).filter(Boolean)
    const deCompras = compras.map((c) => c.Proyecto || c.proyecto).filter(Boolean)
    return [...new Set([...deTablaProyectos, ...deCompras])]
  }, [proyectos, compras])

  const proyectoIdsUnicos = useMemo(() => {
    const deTablaProyectos = proyectos.map((p) => p.ProyectoID_Externo).filter(Boolean)
    const deCompras = compras.map((c) => c.ProyectoID_Externo || c.proyectoID_Externo).filter(Boolean)
    return [...new Set([...deTablaProyectos, ...deCompras])]
  }, [proyectos, compras])

  // Funciones de inicio de sesión conectadas a Azure SQL
  const iniciarSesionEntraID = async (e) => {
    e.preventDefault()
    setErrorLogin('')
    setValidandoLogin(true)

    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo: 'entra',
          email: emailEntraInput.trim()
        })
      })

      const data = await res.json()
      if (!res.ok) {
        setErrorLogin(data.error || 'Correo no autorizado')
        return
      }

      setUsuarioActual(data)
      setEmailEntraInput('')
      const primerModuloPermitido = [
        'gerencia',
        'compras',
        'proyectos',
        'clientes',
        'ingenieria',
        'kanban',
        'almacen',
        'rh',
        'chatbot'
      ].find((k) => data.esMaestro || data.permisos?.[k]?.ver === true)
      if (primerModuloPermitido) setModuloActivo(primerModuloPermitido)
      mostrarToast(`Bienvenido, ${data.nombre}`)
    } catch {
      setErrorLogin('Error de conexión con el servidor al validar acceso')
    } finally {
      setValidandoLogin(false)
    }
  }

  const iniciarSesionMaestra = async (e) => {
    e.preventDefault()
    setErrorLogin('')
    setValidandoLogin(true)

    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo: 'maestro',
          usuario: userMaestroInput.trim(),
          password: passMaestroInput
        })
      })

      const data = await res.json()
      if (!res.ok) {
        setErrorLogin(data.error || 'Usuario o contraseña incorrectos')
        return
      }

      setUsuarioActual(data)
      setUserMaestroInput('')
      setPassMaestroInput('')

      const primerModulo = [
        'gerencia',
        'compras',
        'proyectos',
        'clientes',
        'ingenieria',
        'kanban',
        'almacen',
        'rh',
        'chatbot'
      ].find((k) => data.esMaestro || data.permisos?.[k]?.ver === true)
      if (primerModulo) setModuloActivo(primerModulo)

      mostrarToast(
        data.esMaestro
          ? 'Sesión iniciada como Administrador Maestro'
          : `Bienvenido, ${data.nombre}`
      )
    } catch {
      setErrorLogin('Error de conexión con el servidor al iniciar sesión')
    } finally {
      setValidandoLogin(false)
    }
  }

  const cerrarSesion = () => {
    setModalConfigAbierto(false)
    setUsuarioActual(null)
    setUserMaestroInput('')
    setPassMaestroInput('')
    setErrorLogin('')
  }

  const cancelarEdicion = () => {
    setIdEditando(null)
    setProveedor('')
    setCosto('')
    setCategoria('')
    setProducto('')
    setProyecto('')
    setProyectoIdExterno('')
    setPrecioUnitario('')
    setCantidad('1')
    setFechaCompra('')
    setEstatus('Comprado')
    setMaterial('')
    setNotas('')
    setUrlSaaS('')
    setArchivoSeleccionado(null)
    setModalCompraAbierto(false)
  }

  const abrirModalNuevaCompra = () => {
    if (!puedeEditarModuloActual) {
      mostrarToast('🔒 Modo Solo Lectura: No tienes permisos para registrar compras', 'alerta')
      return
    }
    cancelarEdicion()
    setFechaCompra(new Date().toISOString().split('T')[0])
    setModalCompraAbierto(true)
  }

  const iniciarEdicion = (fila) => {
    if (!puedeEditarModuloActual) {
      mostrarToast('🔒 Modo Solo Lectura: No tienes permisos para editar registros', 'alerta')
      return
    }
    const id = fila.Numero ?? fila.ID ?? fila.Id ?? fila.id
    setIdEditando(id)
    setProveedor(fila.Proveedor || fila.proveedor || '')
    setCosto(fila.Costo ?? fila.costo ?? '')
    setCategoria(fila.Categoria || fila.categoria || '')
    setProducto(fila.Producto || fila.producto || '')
    setProyecto(fila.Proyecto || fila.proyecto || '')
    setProyectoIdExterno(fila.ProyectoID_Externo || fila.proyectoID_Externo || '')
    setPrecioUnitario(fila.PrecioUnitario ?? fila.precioUnitario ?? '')
    setCantidad(fila.Cantidad ?? fila.cantidad ?? '1')
    setEstatus(fila.Estatus || fila.estatus || 'Comprado')
    setMaterial(fila.Material || fila.material || '')
    setNotas(fila.Notas || fila.notas || '')
    setUrlSaaS(fila.URL_SaaS || fila.urlSaaS || '')
    setArchivoSeleccionado(null)

    const valorFecha = fila.FechaCompra || fila.fechaCompra || fila.Fecha || fila.fecha
    setFechaCompra(valorFecha ? String(valorFecha).split('T')[0] : '')
    setModalCompraAbierto(true)
  }

  const manejarEnvio = async (e) => {
    e.preventDefault()
    if (!puedeEditarModuloActual) {
      mostrarToast('🔒 Modo Solo Lectura: No tienes permisos para guardar cambios', 'alerta')
      return
    }
    setGuardando(true)

    const esEdicion = idEditando !== null
    const urlEndpoint = esEdicion ? `${API_URL}/api/compras/${idEditando}` : `${API_URL}/api/compras`
    const metodo = esEdicion ? 'PUT' : 'POST'

    try {
      let respuesta
      if (archivoSeleccionado) {
        const formData = new FormData()
        formData.append('proveedor', proveedor)
        formData.append('costo', parseFloat(costo) || 0)
        formData.append('categoria', categoria)
        formData.append('producto', producto)
        formData.append('proyecto', proyecto)
        formData.append('proyectoIdExterno', proyectoIdExterno)
        formData.append('precioUnitario', parseFloat(precioUnitario) || 0)
        formData.append('cantidad', parseFloat(cantidad) || 1)
        formData.append('fechaCompra', fechaCompra || '')
        formData.append('estatus', estatus || 'Comprado')
        formData.append('material', material)
        formData.append('notas', notas)
        if (urlSaaS) formData.append('urlSaaS', urlSaaS)
        formData.append('archivo', archivoSeleccionado)

        respuesta = await fetch(urlEndpoint, { method: metodo, body: formData })
      } else {
        const datosEnvio = {
          proveedor,
          costo: parseFloat(costo) || 0,
          categoria,
          producto,
          proyecto,
          proyectoIdExterno,
          precioUnitario: parseFloat(precioUnitario) || 0,
          cantidad: parseFloat(cantidad) || 1,
          urlSaaS,
          fechaCompra: fechaCompra || null,
          estatus: estatus || 'Comprado',
          material,
          notas
        }

        respuesta = await fetch(urlEndpoint, {
          method: metodo,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datosEnvio)
        })
      }

      if (!respuesta.ok) throw new Error(`No se pudo ${esEdicion ? 'actualizar' : 'registrar'} la operación`)

      mostrarToast(esEdicion ? `Registro #${idEditando} actualizado` : 'Nueva compra registrada en Azure SQL')
      cancelarEdicion()
      await recargarDatos(true)
    } catch (err) {
      mostrarToast(err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  const manejarCancelarRegistro = () => {
    if (!idEditando || !puedeEditarModuloActual) return
    setConfirmacionModal({
      titulo: `¿Cancelar el Registro #${idEditando}?`,
      descripcion: `El registro de "${producto || 'este artículo'}" pasará a estatus Cancelado.`,
      textoConfirmar: 'Sí, cancelar registro',
      alConfirmar: async () => {
        setGuardando(true)
        try {
          const res = await fetch(`${API_URL}/api/compras/${idEditando}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proveedor,
              costo: parseFloat(costo) || 0,
              categoria,
              producto,
              proyecto,
              proyectoIdExterno,
              precioUnitario: parseFloat(precioUnitario) || 0,
              cantidad: parseFloat(cantidad) || 1,
              urlSaaS,
              fechaCompra: fechaCompra || null,
              estatus: 'Cancelado',
              material,
              notas
            })
          })
          if (!res.ok) throw new Error('Error al cancelar el registro')
          mostrarToast(`Registro #${idEditando} cancelado`, 'alerta')
          setConfirmacionModal(null)
          cancelarEdicion()
          await recargarDatos(true)
        } catch (err) {
          mostrarToast(err.message, 'error')
        } finally {
          setGuardando(false)
        }
      }
    })
  }

  // PANTALLA DE LOGIN
  if (!usuarioConPermisosActualizados) {
    return (
      <div style={estilos.loginScreen}>
        <div className="pro-card" style={estilos.loginCard}>
          <div style={{ textAlign: 'center', marginBottom: '22px' }}>
            <div style={{ ...estilos.brandLogo, width: '48px', height: '48px', fontSize: '22px', margin: '0 auto 12px' }}>
              P
            </div>
            <h2 style={{ fontSize: '21px' }}>PROTEMEC CLOUD ERP</h2>
            <p style={{ fontSize: '13px', color: '#86868b', marginTop: '4px' }}>
              Control Industrial, Ingeniería CAD 3D y Finanzas
            </p>
          </div>

          <div className="pro-segmented" style={{ width: '100%', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <button
              type="button"
              className={`pro-segmented-btn ${modoLogin === 'maestro' ? 'active' : ''}`}
              onClick={() => { setModoLogin('maestro'); setErrorLogin('') }}
              style={{ justifyContent: 'center' }}
            >
              🔑 Usuario y Contraseña
            </button>
            <button
              type="button"
              className={`pro-segmented-btn ${modoLogin === 'entra' ? 'active' : ''}`}
              onClick={() => { setModoLogin('entra'); setErrorLogin('') }}
              style={{ justifyContent: 'center' }}
            >
              🛡️ Microsoft Entra ID
            </button>
          </div>

          {errorLogin && (
            <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#fef2f2', color: '#991b1b', fontSize: '12px', marginBottom: '14px', fontWeight: 600 }}>
              ⚠️ {errorLogin}
            </div>
          )}

          {modoLogin === 'maestro' ? (
            <form onSubmit={iniciarSesionMaestra} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="pro-label">Usuario</label>
                <input
                  type="text"
                  value={userMaestroInput}
                  onChange={(e) => setUserMaestroInput(e.target.value)}
                  placeholder="Ingresa tu usuario..."
                  required
                  className="pro-input pro-mono"
                />
              </div>
              <div>
                <label className="pro-label">Contraseña</label>
                <input
                  type="password"
                  value={passMaestroInput}
                  onChange={(e) => setPassMaestroInput(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="pro-input pro-mono"
                />
              </div>
              <button
                type="submit"
                disabled={validandoLogin}
                className="pro-btn pro-btn-primary"
                style={{ padding: '11px' }}
              >
                {validandoLogin ? 'Verificando en Azure SQL...' : 'Iniciar Sesión'}
              </button>
            </form>
          ) : (
            <form onSubmit={iniciarSesionEntraID} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="pro-label">Correo Corporativo Microsoft Entra ID</label>
                <input
                  type="email"
                  value={emailEntraInput}
                  onChange={(e) => setEmailEntraInput(e.target.value)}
                  placeholder="usuario@protemec.com"
                  required
                  className="pro-input pro-mono"
                />
              </div>

              <button
                type="submit"
                disabled={validandoLogin}
                className="pro-btn pro-btn-primary"
                style={{ padding: '11px' }}
              >
                {validandoLogin ? 'Verificando en Azure SQL...' : 'Continuar con Microsoft Entra ID'}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  const menuNavegacion = [
    { id: 'gerencia', label: 'Dirección y KPIs', icono: '📊', badge: null },
    { id: 'compras', label: 'Compras y Finanzas', icono: '💳', badge: compras.length },
    { id: 'proyectos', label: 'Proyectos', icono: '📁', badge: proyectos.length },
    { id: 'clientes', label: 'Clientes y Directorio', icono: '🏢', badge: clientes.length },
    { id: 'ingenieria', label: 'Ingeniería y BOM 3D', icono: '⚙️', badge: disenos.length },
    { id: 'kanban', label: 'Tablero Kanban', icono: '📋', badge: disenos.length },
    { id: 'almacen', label: 'Almacén Digital 3D', icono: '📦', badge: null },
    { id: 'rh', label: 'Recursos Humanos', icono: '👥', badge: personalRH.filter((p) => p.Activo).length },
    { id: 'chatbot', label: 'Asistente IA', icono: '✨', badge: 'AI' }
  ].filter(
    (item) =>
      usuarioConPermisosActualizados.esMaestro ||
      usuarioConPermisosActualizados.permisos?.[item.id]?.ver === true
  )

  const infoEncabezado = {
    gerencia: {
      titulo: 'Tablero de Dirección y Alto Nivel',
      subtitulo: 'Costos consolidados por proyecto, proveedores estratégicos y rendimiento global'
    },
    compras: {
      titulo: 'Módulo de Compras y Cotizaciones',
      subtitulo: 'Control financiero, órdenes de compra y facturas en Azure Blob Storage'
    },
    proyectos: {
      titulo: 'Portafolio de Proyectos',
      subtitulo: 'Gestión de folios externos, clientes asignados y plantas operativas'
    },
    clientes: {
      titulo: 'Relación con Clientes (CRM)',
      subtitulo: 'Catálogo corporativo de empresas, ubicaciones industriales y directorio'
    },
    ingenieria: {
      titulo: 'Ingeniería, CAD 3D y Estructura BOM',
      subtitulo: 'Árbol jerárquico de ensambles, modelos CAD 3D y especificaciones de diseño'
    },
    kanban: {
      titulo: 'Tablero Kanban y Control de Avance',
      subtitulo: 'Flujo de trabajo por proyecto, registro de avance y vinculación con salidas de almacén'
    },
    almacen: {
      titulo: 'Gemelo Digital de Almacén e Inventario',
      subtitulo: 'Entradas de stock, salidas en grupo, préstamos a sitio y localización 3D'
    },
    rh: {
      titulo: 'Gestión de Personal y Rendimiento (RH)',
      subtitulo: 'Expedientes de colaboradores de planta, estatus activo/baja y evaluación de KPIs'
    },
    chatbot: {
      titulo: 'Protemec Intelligence',
      subtitulo: 'Copiloto empresarial conectado a tus operaciones'
    }
  }[moduloActivo] || { titulo: 'Protemec ERP', subtitulo: '' }

  // CANDADO 3: Bloqueo en fase de captura para eventos de formulario, clic en botones de edición y Drag & Drop
  const bloquearEnvioEnSoloLectura = (e) => {
    if (!puedeEditarModuloActual && moduloActivo !== 'chatbot') {
      e.preventDefault()
      e.stopPropagation()
      mostrarToast('🔒 Modo Solo Lectura: No tienes permisos para dar de alta ni modificar datos', 'alerta')
    }
  }

  const bloquearClicEdicionEnSoloLectura = (e) => {
    if (puedeEditarModuloActual) return
    const btn = e.target.closest('button')
    if (!btn) return
    const texto = btn.textContent || ''
    const titulo = btn.getAttribute('title') || ''
    const tipo = (btn.getAttribute('type') || '').toLowerCase()
    const clase = btn.className || ''

    if (!esBotonDeSoloConsulta(texto, clase) && esBotonDeEscritura(texto, titulo, tipo)) {
      e.preventDefault()
      e.stopPropagation()
      mostrarToast('🔒 Modo Solo Lectura: Acción deshabilitada para tu perfil', 'alerta')
    }
  }

  const bloquearDropEnSoloLectura = (e) => {
    if (!puedeEditarModuloActual) {
      e.preventDefault()
      e.stopPropagation()
      mostrarToast('🔒 Modo Solo Lectura: No puedes mover ni modificar avances', 'alerta')
    }
  }

  const enVistaVisor3DPuro = moduloActivo === 'almacen' && subVistaAlmacen === 'visor3d'

  return (
    <div style={estilos.appLayout}>
      {notificacion && (
        <div style={estilos.toastIsland(notificacion.tipo)}>
          <span>{notificacion.tipo === 'exito' ? '✓' : notificacion.tipo === 'error' ? '✕' : '⚠️'}</span>
          <span>{notificacion.mensaje}</span>
        </div>
      )}

      {/* BARRA LATERAL */}
      <aside style={estilos.sidebar(sidebarColapsado)}>
        <div style={estilos.sidebarBrand}>
          <div style={estilos.brandLogo}>P</div>
          {!sidebarColapsado && (
            <div style={{ overflow: 'hidden' }}>
              <div style={estilos.brandTitle}>PROTEMEC</div>
              <div style={estilos.brandSubtitle}>Enterprise Cloud ERP</div>
            </div>
          )}
          <button
            onClick={() => setSidebarColapsado(!sidebarColapsado)}
            style={estilos.btnColapsar}
            title={sidebarColapsado ? 'Expandir menú' : 'Contraer menú'}
          >
            {sidebarColapsado ? '»' : '«'}
          </button>
        </div>

        <div style={estilos.navGroupLabel}>
          {!sidebarColapsado ? 'MÓDULOS AUTORIZADOS' : '•••'}
        </div>

        <nav style={estilos.navMenu}>
          {menuNavegacion.map((item) => {
            const activo = moduloActivo === item.id
            return (
              <button
                key={item.id}
                onClick={() => setModuloActivo(item.id)}
                style={estilos.navItem(activo, sidebarColapsado)}
                title={sidebarColapsado ? item.label : ''}
              >
                <span style={{ fontSize: '16px', lineHeight: 1 }}>{item.icono}</span>
                {!sidebarColapsado && (
                  <>
                    <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                    {item.badge !== null && item.badge !== 0 && (
                      <span style={estilos.navBadge(activo)}>{item.badge}</span>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </nav>

        {/* PIE DE BARRA LATERAL */}
        <div style={estilos.sidebarFooter}>
          {puedeVerSeguridad && (
            <button
              onClick={() => setModalConfigAbierto(true)}
              style={estilos.navItem(false, sidebarColapsado)}
              title="Administración de Perfiles y Seguridad"
            >
              <span style={{ fontSize: '16px' }}>🛡️</span>
              {!sidebarColapsado && (
                <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>Perfiles y Accesos</span>
              )}
            </button>
          )}

          {!sidebarColapsado ? (
            <div style={estilos.azureStatusCard}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#1d1d1f', marginBottom: '2px' }}>
                {usuarioConPermisosActualizados.esMaestro ? '👑 ' : '👤 '}
                {usuarioConPermisosActualizados.nombre}
              </div>
              <div className="pro-mono" style={{ fontSize: '10.5px', color: '#86868b', marginBottom: '10px' }}>
                {usuarioConPermisosActualizados.usuario || usuarioConPermisosActualizados.email}
              </div>

              <button
                onClick={cerrarSesion}
                className="pro-btn pro-btn-secondary pro-btn-sm"
                style={{ width: '100%', fontSize: '11.5px', padding: '6px', fontWeight: 600 }}
              >
                🚪 Cerrar Sesión
              </button>
            </div>
          ) : (
            <button
              onClick={cerrarSesion}
              style={estilos.navItem(false, true)}
              title="Cerrar Sesión"
            >
              <span style={{ fontSize: '16px' }}>🚪</span>
            </button>
          )}
        </div>
      </aside>

      {/* ÁREA DE CONTENIDO PRINCIPAL */}
      <div
        style={{
          ...estilos.mainWrapper,
          overflowY: enVistaVisor3DPuro ? 'hidden' : 'auto'
        }}
      >
        <header style={estilos.topHeader}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1d1d1f' }}>
                {infoEncabezado.titulo}
              </h1>
              {!puedeEditarModuloActual && (
                <span
                  className="pro-badge"
                  style={{
                    backgroundColor: '#fffbeb',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                    fontWeight: 700
                  }}
                >
                  🔒 Modo Solo Lectura (Sin permiso de edición)
                </span>
              )}
            </div>
            <p style={{ fontSize: '12.5px', color: '#86868b', marginTop: '1px' }}>
              {infoEncabezado.subtitulo}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {moduloActivo === 'ingenieria' && (
              <div className="pro-segmented">
                <button
                  className={`pro-segmented-btn ${subVistaIngenieria === 'explorador' ? 'active' : ''}`}
                  onClick={() => setSubVistaIngenieria('explorador')}
                >
                  🧊 Explorador 3D
                </button>
                <button
                  className={`pro-segmented-btn ${subVistaIngenieria === 'avance' ? 'active' : ''}`}
                  onClick={() => setSubVistaIngenieria('avance')}
                >
                  📊 Control de Avance (Kanban / Calendario)
                </button>
                {puedeEditarModuloActual && (
                  <button
                    className={`pro-segmented-btn ${subVistaIngenieria === 'nuevo' ? 'active' : ''}`}
                    onClick={() => setSubVistaIngenieria('nuevo')}
                  >
                    ➕ Registrar Pieza
                  </button>
                )}
              </div>
            )}

            {moduloActivo === 'almacen' && (
              <div className="pro-segmented">
                <button
                  className={`pro-segmented-btn ${subVistaAlmacen === 'inventario' ? 'active' : ''}`}
                  onClick={() => setSubVistaAlmacen('inventario')}
                >
                  📋 Recepción y Stock
                </button>
                <button
                  className={`pro-segmented-btn ${subVistaAlmacen === 'visor3d' ? 'active' : ''}`}
                  onClick={() => setSubVistaAlmacen('visor3d')}
                >
                  📦 Gemelo Digital 3D
                </button>
              </div>
            )}

            <button
              onClick={() => recargarDatos(false)}
              disabled={sincronizando}
              className="pro-btn pro-btn-secondary"
              title="Actualizar datos desde Azure SQL"
            >
              <span style={{ display: 'inline-block', animation: sincronizando ? 'spin 0.8s linear infinite' : 'none' }}>
                ↻
              </span>
              <span>{sincronizando ? 'Sincronizando...' : 'Sincronizar'}</span>
            </button>

            {moduloActivo === 'compras' && puedeEditarModuloActual && (
              <button onClick={abrirModalNuevaCompra} className="pro-btn pro-btn-primary">
                <span>＋</span>
                <span>Nueva Compra / Cotización</span>
              </button>
            )}
          </div>
        </header>

        <main
          ref={mainContentRef}
          style={estilos.mainContent}
          onSubmitCapture={bloquearEnvioEnSoloLectura}
          onClickCapture={bloquearClicEdicionEnSoloLectura}
          onDropCapture={bloquearDropEnSoloLectura}
        >
          {cargando ? (
            <div style={estilos.loaderContainer}>
              <div style={estilos.appleSpinner} />
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginTop: '14px' }}>
                Conectando con Azure SQL Database...
              </h3>
            </div>
          ) : (
            <div key={`${moduloActivo}_${puedeEditarModuloActual}`} className="animate-view">
              {/* 1. MÓDULO GERENCIA Y SEGUIMIENTO DE ALTO NIVEL */}
              {moduloActivo === 'gerencia' && (
                <GestionGerencia
                  compras={compras}
                  proyectos={proyectos}
                  disenos={disenos}
                  personalRH={personalRH}
                  evaluacionesKPI={evaluacionesKPI}
                  puedeEditar={puedeEditarModuloActual}
                />
              )}

              {/* 2. MÓDULO DE COMPRAS */}
              {moduloActivo === 'compras' && (
                <VistaConsulta
                  compras={compras}
                  iniciarEdicion={puedeEditarModuloActual ? iniciarEdicion : () => mostrarToast('🔒 Modo Solo Lectura', 'alerta')}
                  abrirModalNuevaCompra={abrirModalNuevaCompra}
                  proveedoresUnicos={proveedoresUnicos}
                  categoriasUnicas={categoriasUnicas}
                  proyectosUnicos={proyectosUnicos}
                  puedeEditar={puedeEditarModuloActual}
                />
              )}

              {/* 3. MÓDULO DE PROYECTOS */}
              {moduloActivo === 'proyectos' && (
                <GestionProyectos
                  proyectos={proyectos}
                  clientes={clientes}
                  ubicaciones={ubicaciones}
                  API_URL={API_URL}
                  recargarDatos={() => recargarDatos(true)}
                  mostrarToast={mostrarToast}
                  puedeEditar={puedeEditarModuloActual}
                />
              )}

              {/* 4. MÓDULO DE CLIENTES (CRM) */}
              {moduloActivo === 'clientes' && (
                <GestionClientes
                  clientes={clientes}
                  ubicaciones={ubicaciones}
                  contactos={contactos}
                  API_URL={API_URL}
                  recargarDatos={() => recargarDatos(true)}
                  mostrarToast={mostrarToast}
                  puedeEditar={puedeEditarModuloActual}
                />
              )}

              {/* 5. MÓDULO DE INGENIERÍA 3D */}
              {moduloActivo === 'ingenieria' && (
                <GestionIngenieria
                  disenos={disenos}
                  proyectosUnicos={proyectosUnicos}
                  API_URL={API_URL}
                  recargarDatos={() => recargarDatos(true)}
                  subVista={subVistaIngenieria}
                  setPestanaIngenieria={setSubVistaIngenieria}
                  mostrarToast={mostrarToast}
                  puedeEditar={puedeEditarModuloActual}
                />
              )}

              {/* 5.1. MÓDULO DE TABLERO KANBAN SEPARADO */}
              {moduloActivo === 'kanban' && (
                <GestionKanban
                  disenos={disenos}
                  proyectosUnicos={proyectosUnicos}
                  movimientosAlmacen={movimientosAlmacen}
                  API_URL={API_URL}
                  recargarDatos={() => recargarDatos(true)}
                  mostrarToast={mostrarToast}
                  puedeEditar={puedeEditarModuloActual}
                  usuarioActual={usuarioConPermisosActualizados}
                />
              )}

              {/* 6. MÓDULO DE ALMACÉN, SALIDAS Y PRÉSTAMOS CON RH */}
              {moduloActivo === 'almacen' && (
                subVistaAlmacen === 'inventario' ? (
                  <GestionAlmacenInventario
                    compras={compras}
                    proyectos={proyectos}
                    personalRH={personalRH}
                    usuarioActual={usuarioConPermisosActualizados}
                    API_URL={API_URL}
                    recargarDatos={() => recargarDatos(true)}
                    mostrarToast={mostrarToast}
                    irAlVisor3D={() => setSubVistaAlmacen('visor3d')}
                    puedeEditar={puedeEditarModuloActual}
                    syncTrigger={syncTrigger}
                  />
                ) : (
                  <GestionAlmacen3D
                    API_URL={API_URL}
                    puedeEditar={puedeEditarModuloActual}
                    esModal={false}
                    syncTrigger={syncTrigger}
                  />
                )
              )}

              {/* 7. MÓDULO DE RECURSOS HUMANOS Y KPIS */}
              {moduloActivo === 'rh' && (
                <GestionRH
                  personalRH={personalRH}
                  evaluacionesKPI={evaluacionesKPI}
                  API_URL={API_URL}
                  recargarDatos={() => recargarDatos(true)}
                  mostrarToast={mostrarToast}
                  puedeEditar={puedeEditarModuloActual}
                />
              )}

              {/* 8. ASISTENTE IA */}
              {moduloActivo === 'chatbot' && <GestionChatbot compras={compras} proyectos={proyectos} />}
            </div>
          )}
        </main>
      </div>

      {/* PORTAL PARA FORMULARIO DE COMPRA (SOLO SI TIENE PERMISO DE EDITAR) */}
      {modalCompraAbierto &&
        puedeEditarModuloActual &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={cancelarEdicion}>
            <div
              className="pro-modal-window"
              style={{ maxWidth: '880px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pro-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={estilos.modalIconBadge(idEditando)}>{idEditando ? '✏️' : '＋'}</span>
                  <div>
                    <h3 style={{ fontSize: '16px', margin: 0 }}>
                      {idEditando ? `Modificar Registro #${idEditando}` : 'Registrar Nueva Compra o Cotización'}
                    </h3>
                  </div>
                </div>
                <button onClick={cancelarEdicion} style={estilos.btnCloseCircle}>✕</button>
              </div>

              <div className="pro-modal-body">
                <FormularioCompra
                  idEditando={idEditando}
                  proveedor={proveedor}
                  setProveedor={setProveedor}
                  costo={costo}
                  setCosto={setCosto}
                  categoria={categoria}
                  setCategoria={setCategoria}
                  producto={producto}
                  setProducto={setProducto}
                  proyecto={proyecto}
                  setProyecto={setProyecto}
                  proyectoIdExterno={proyectoIdExterno}
                  setProyectoIdExterno={setProyectoIdExterno}
                  precioUnitario={precioUnitario}
                  setPrecioUnitario={setPrecioUnitario}
                  cantidad={cantidad}
                  setCantidad={setCantidad}
                  fechaCompra={fechaCompra}
                  setFechaCompra={setFechaCompra}
                  estatus={estatus}
                  setEstatus={setEstatus}
                  material={material}
                  setMaterial={setMaterial}
                  notas={notas}
                  setNotas={setNotas}
                  setArchivoSeleccionado={setArchivoSeleccionado}
                  guardando={guardando}
                  manejarEnvio={manejarEnvio}
                  cancelarEdicion={cancelarEdicion}
                  manejarCancelarRegistro={manejarCancelarRegistro}
                  proveedoresUnicos={proveedoresUnicos}
                  categoriasUnicas={categoriasUnicas}
                  productosUnicos={productosUnicos}
                  materialesUnicos={materialesUnicos}
                  proyectosUnicos={proyectosUnicos}
                  proyectoIdsUnicos={proyectoIdsUnicos}
                />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* PORTAL PARA CONFIRMACIÓN DE CANCELACIÓN */}
      {confirmacionModal &&
        puedeEditarModuloActual &&
        createPortal(
          <div className="pro-modal-backdrop" onClick={() => setConfirmacionModal(null)}>
            <div className="pro-modal-window" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
              <div className="pro-modal-body" style={{ textAlign: 'center', padding: '28px 24px 20px' }}>
                <div style={estilos.warningCircle}>⚠️</div>
                <h3 style={{ fontSize: '17px', marginBottom: '8px' }}>{confirmacionModal.titulo}</h3>
                <p style={{ fontSize: '13px', color: '#515154' }}>{confirmacionModal.descripcion}</p>
              </div>
              <div className="pro-modal-footer">
                <button type="button" onClick={() => setConfirmacionModal(null)} className="pro-btn pro-btn-secondary" style={{ flex: 1 }}>
                  Conservar
                </button>
                <button type="button" onClick={confirmacionModal.alConfirmar} className="pro-btn pro-btn-danger" style={{ flex: 1 }}>
                  {confirmacionModal.textoConfirmar}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL DE SEGURIDAD, PERFILES RBAC Y ENTRA ID */}
      {puedeVerSeguridad && (
        <ModalConfiguracion
          abierto={modalConfigAbierto}
          alCerrar={() => setModalConfigAbierto(false)}
          API_URL={API_URL}
          perfilesUsuarios={perfilesUsuarios}
          setPerfilesUsuarios={setPerfilesUsuarios}
          credencialesMaestras={credencialesMaestras}
          setCredencialesMaestras={setCredencialesMaestras}
          usuarioActual={usuarioConPermisosActualizados}
          puedeDarPermisos={puedeDarPermisos}
          mostrarToast={mostrarToast}
          recargarDatos={() => recargarDatos(true)}
        />
      )}
    </div>
  )
}

const estilos = {
  loginScreen: {
    minHeight: '100vh',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'radial-gradient(circle at top, #ffffff 0%, #e8e8ed 100%)',
    padding: '20px'
  },
  loginCard: {
    width: '100%',
    maxWidth: '430px',
    padding: '32px',
    borderRadius: '22px',
    boxShadow: '0 24px 48px rgba(0,0,0,0.08)'
  },
  appLayout: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: 'var(--bg-canvas)'
  },
  sidebar: (colapsado) => ({
    width: colapsado ? '74px' : '264px',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRight: '1px solid var(--border-light)',
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 12px',
    transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    position: 'sticky',
    top: 0,
    height: '100vh',
    zIndex: 100
  }),
  sidebarBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 6px 16px 6px',
    borderBottom: '1px solid var(--border-light)',
    marginBottom: '14px'
  },
  brandLogo: {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #1d1d1f 0%, #434346 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: '16px',
    flexShrink: 0
  },
  brandTitle: {
    fontWeight: 800,
    fontSize: '14px',
    letterSpacing: '-0.02em',
    color: '#1d1d1f'
  },
  brandSubtitle: {
    fontSize: '11px',
    color: '#86868b',
    fontWeight: 500
  },
  btnColapsar: {
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: '#86868b',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 6px'
  },
  navGroupLabel: {
    fontSize: '10.5px',
    fontWeight: 700,
    color: '#86868b',
    padding: '0 10px',
    marginBottom: '8px',
    letterSpacing: '0.06em'
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1
  },
  navItem: (activo, colapsado) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: colapsado ? 'center' : 'flex-start',
    gap: '11px',
    padding: '10px 12px',
    borderRadius: '10px',
    border: 'none',
    backgroundColor: activo ? '#0071e3' : 'transparent',
    color: activo ? '#ffffff' : '#3a3a3c',
    fontWeight: activo ? 600 : 500,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    width: '100%'
  }),
  navBadge: (activo) => ({
    fontSize: '11px',
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: '999px',
    backgroundColor: activo ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.06)',
    color: activo ? '#ffffff' : '#515154'
  }),
  sidebarFooter: {
    borderTop: '1px solid var(--border-light)',
    paddingTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  azureStatusCard: {
    backgroundColor: '#f5f5f7',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid rgba(0,0,0,0.05)'
  },
  mainWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    height: '100vh',
    overflowY: 'auto',
    overflowX: 'auto'
  },
  topHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 90,
    backgroundColor: 'rgba(245, 245, 247, 0.82)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    borderBottom: '1px solid var(--border-light)',
    padding: '16px 28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap'
  },
  mainContent: {
    padding: '18px 22px',
    flex: 1,
    minWidth: 0
  },
  loaderContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '65vh'
  },
  appleSpinner: {
    width: '32px',
    height: '32px',
    border: '3px solid rgba(0, 113, 227, 0.18)',
    borderTopColor: '#0071e3',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  modalIconBadge: (esEdicion) => ({
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: esEdicion ? 'rgba(0, 113, 227, 0.12)' : 'rgba(16, 185, 129, 0.12)',
    color: esEdicion ? '#0071e3' : '#059669',
    fontWeight: 700,
    fontSize: '16px'
  }),
  btnCloseCircle: {
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: '#e8e8ed',
    color: '#515154',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer'
  },
  warningCircle: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    backgroundColor: '#fef2f2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
    margin: '0 auto 14px'
  },
  toastIsland: (tipo) => ({
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9999,
    backgroundColor: '#1d1d1f',
    color: '#ffffff',
    padding: '10px 20px',
    borderRadius: '999px',
    boxShadow: '0 14px 30px rgba(0, 0, 0, 0.25)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    fontWeight: 600,
    border: `1px solid ${tipo === 'error' ? '#ef4444' : tipo === 'alerta' ? '#f59e0b' : 'rgba(255,255,255,0.15)'}`,
    animation: 'toastPop 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards'
  })
}