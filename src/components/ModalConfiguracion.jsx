import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

const MODULOS_SISTEMA = [
  { id: 'gerencia', label: '📊 Dirección y Alto Nivel', desc: 'Análisis gerencial con gráficas de costos, proveedores y KPIs' },
  { id: 'compras', label: '💳 Compras y Finanzas', desc: 'Consulta de órdenes, costos, proveedores y facturas PDF' },
  { id: 'proyectos', label: '📁 Portafolio de Proyectos', desc: 'Catálogo de folios externos, clientes y estatus de obra' },
  { id: 'clientes', label: '🏢 Clientes y Directorio', desc: 'Empresas, plantas industriales y contactos' },
  { id: 'ingenieria', label: '⚙️ Ingeniería y BOM 3D', desc: 'Visor CAD 3D, ensambles y planos técnicos' },
  { id: 'kanban', label: '📋 Tablero Kanban y Producción', desc: 'Control de avance por piezas/ensambles, conteo y vinculación con almacén' },
  { id: 'almacen', label: '📦 Almacén Digital 3D', desc: 'Entradas manuales, salidas, préstamos de herramienta y visor 3D' },
  { id: 'rh', label: '👥 Recursos Humanos y KPIs', desc: 'Expedientes de personal (activo/baja) y evaluación mensual de rendimiento' },
  { id: 'chatbot', label: '✨ Asistente IA', desc: 'Consultas rápidas mediante inteligencia artificial' },
  { id: 'seguridad', label: '🛡️ Seguridad y Gestión de Perfiles', desc: 'Permite ver este panel de seguridad y dar permisos a otros usuarios' }
]
export default function ModalConfiguracion({
  abierto,
  alCerrar,
  API_URL,
  CHAT_API_URL = 'https://api-chatbot-e0e5gtfvbdf6aact.westus3-01.azurewebsites.net',
  perfilesUsuarios = [],
  setPerfilesUsuarios,
  credencialesMaestras,
  setCredencialesMaestras,
  usuarioActual,
  puedeDarPermisos = false,
  mostrarToast,
  recargarDatos
}) {
  const [pestana, setPestana] = useState('permisos')
  const [perfilSeleccionadoId, setPerfilSeleccionadoId] = useState(perfilesUsuarios[0]?.id || null)
  const [mostrarFormularioNuevo, setMostrarFormularioNuevo] = useState(false)
  const [guardandoDB, setGuardandoDB] = useState(false)
  const [tablasBD, setTablasBD] = useState([])
  const [cargandoTablas, setCargandoTablas] = useState(false)

  // Estados para crear un Nuevo Perfil con Nombre, Usuario y Contraseña
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoUsuario, setNuevoUsuario] = useState('')
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [nuevoEmail, setNuevoEmail] = useState('')
  const [nuevoRol, setNuevoRol] = useState('Ingeniería')

  // Estados para Credenciales Maestras (Admin)
  const [userMaestroTemp, setUserMaestroTemp] = useState(credencialesMaestras?.usuario || 'admin')
  const [passMaestroTemp, setPassMaestroTemp] = useState(credencialesMaestras?.password || '')

  useEffect(() => {
    if (credencialesMaestras) {
      setUserMaestroTemp(credencialesMaestras.usuario || 'admin')
      setPassMaestroTemp(credencialesMaestras.password || '')
    }
  }, [credencialesMaestras])

  useEffect(() => {
    if (perfilesUsuarios.length > 0 && !perfilesUsuarios.some((p) => p.id === perfilSeleccionadoId)) {
      setPerfilSeleccionadoId(perfilesUsuarios[0].id)
    }
  }, [perfilesUsuarios, perfilSeleccionadoId])

  // Cargar lista real de tablas de Azure SQL desde el servidor MCP
  useEffect(() => {
    if (!abierto) return
    const esLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    const baseChatUrl = esLocal
      ? 'http://localhost:3001'
      : String(CHAT_API_URL || 'https://api-chatbot-e0e5gtfvbdf6aact.westus3-01.azurewebsites.net').replace(/\/+$/, '')

    let cancelado = false
    setCargandoTablas(true)
    fetch(`${baseChatUrl}/api/tablas`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelado && Array.isArray(data?.tablas)) {
          setTablasBD(data.tablas)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setCargandoTablas(false)
      })

    return () => {
      cancelado = true
    }
  }, [abierto, CHAT_API_URL])

  if (!abierto) return null

  const esMaestro = Boolean(usuarioActual?.esMaestro)
  const autorizadoParaEditarPermisos = Boolean(esMaestro || puedeDarPermisos)
  const perfilActivo = perfilesUsuarios.find((p) => p.id === perfilSeleccionadoId) || perfilesUsuarios[0]

  // Guardar un perfil actualizado en Azure SQL
  const persistirPerfilEnSQL = async (perfilActualizado, mensajeExito = null) => {
    try {
      setGuardandoDB(true)
      const res = await fetch(`${API_URL}/api/usuarios/${perfilActualizado.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(perfilActualizado)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar cambios en Azure SQL')

      setPerfilesUsuarios((prev) => prev.map((p) => (p.id === data.id ? data : p)))
      if (mensajeExito && mostrarToast) mostrarToast(mensajeExito)
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setGuardandoDB(false)
    }
  }

  // Cambiar switches de Ver / Editar de cada módulo y guardar en Azure SQL
  const togglePermiso = async (moduloId, tipoPermiso) => {
    if (!autorizadoParaEditarPermisos || !perfilActivo) {
      if (mostrarToast) mostrarToast('No tienes privilegios para modificar permisos', 'alerta')
      return
    }

    const permisoActual = perfilActivo.permisos?.[moduloId] || { ver: false, editar: false }
    const nuevoValor = !permisoActual[tipoPermiso]

    const permisoActualizado = {
      ...permisoActual,
      [tipoPermiso]: nuevoValor
    }
    if (tipoPermiso === 'ver' && !nuevoValor) {
      permisoActualizado.editar = false
    }
    if (tipoPermiso === 'editar' && nuevoValor) {
      permisoActualizado.ver = true
    }

    const perfilModificado = {
      ...perfilActivo,
      permisos: {
        ...perfilActivo.permisos,
        [moduloId]: permisoActualizado
      }
    }

    // Actualización inmediata en interfaz + persistencia en Azure SQL
    setPerfilesUsuarios((prev) =>
      prev.map((p) => (p.id === perfilActivo.id ? perfilModificado : p))
    )
    await persistirPerfilEnSQL(perfilModificado)
  }

  // Cambiar configuración de IA (acceso total a tablas o búsqueda en línea)
  const toggleConfigIA = async (campo) => {
    if (!autorizadoParaEditarPermisos || !perfilActivo) {
      if (mostrarToast) mostrarToast('No tienes privilegios para modificar permisos', 'alerta')
      return
    }
    const iaActual = perfilActivo.permisos?.ia || {
      accesoTotalTablas: true,
      tablasPermitidas: [],
      busquedaEnLinea: false
    }
    const nuevoValor = campo === 'accesoTotalTablas' ? !(iaActual.accesoTotalTablas !== false) : !iaActual[campo]
    const iaActualizada = { ...iaActual, [campo]: nuevoValor }

    // Si pasa de acceso total a restringido por primera vez y no tiene lista, preseleccionamos las actuales
    if (campo === 'accesoTotalTablas' && !nuevoValor && (!iaActual.tablasPermitidas || iaActual.tablasPermitidas.length === 0)) {
      iaActualizada.tablasPermitidas = [...tablasBD]
    }

    const perfilModificado = {
      ...perfilActivo,
      permisos: { ...perfilActivo.permisos, ia: iaActualizada }
    }
    setPerfilesUsuarios((prev) => prev.map((p) => (p.id === perfilActivo.id ? perfilModificado : p)))
    await persistirPerfilEnSQL(perfilModificado)
  }

  // Activar/desactivar una tabla específica para la IA del usuario
  const toggleTablaIA = async (nombreTabla) => {
    if (!autorizadoParaEditarPermisos || !perfilActivo) return
    const iaActual = perfilActivo.permisos?.ia || {
      accesoTotalTablas: false,
      tablasPermitidas: [],
      busquedaEnLinea: false
    }
    const listaActual = Array.isArray(iaActual.tablasPermitidas) ? iaActual.tablasPermitidas : []
    const yaTiene = listaActual.includes(nombreTabla)
    const nuevaLista = yaTiene ? listaActual.filter((t) => t !== nombreTabla) : [...listaActual, nombreTabla]

    const perfilModificado = {
      ...perfilActivo,
      permisos: {
        ...perfilActivo.permisos,
        ia: { ...iaActual, accesoTotalTablas: false, tablasPermitidas: nuevaLista }
      }
    }
    setPerfilesUsuarios((prev) => prev.map((p) => (p.id === perfilActivo.id ? perfilModificado : p)))
    await persistirPerfilEnSQL(perfilModificado)
  }

  const aplicarLoteTablasIA = async (seleccionarTodas) => {
    if (!autorizadoParaEditarPermisos || !perfilActivo) return
    const iaActual = perfilActivo.permisos?.ia || {
      accesoTotalTablas: false,
      tablasPermitidas: [],
      busquedaEnLinea: false
    }
    const perfilModificado = {
      ...perfilActivo,
      permisos: {
        ...perfilActivo.permisos,
        ia: {
          ...iaActual,
          accesoTotalTablas: false,
          tablasPermitidas: seleccionarTodas ? [...tablasBD] : []
        }
      }
    }
    setPerfilesUsuarios((prev) => prev.map((p) => (p.id === perfilActivo.id ? perfilModificado : p)))
    await persistirPerfilEnSQL(perfilModificado)
  }

  // Actualizar Nombre, Usuario, Email o Contraseña en el estado local
  const actualizarCampoPerfil = (campo, valor) => {
    if (!autorizadoParaEditarPermisos || !perfilActivo) return
    setPerfilesUsuarios((prev) =>
      prev.map((p) => (p.id === perfilActivo.id ? { ...p, [campo]: valor } : p))
    )
  }

  // Crear un nuevo perfil en Azure SQL
  const crearNuevoPerfil = async (e) => {
    e.preventDefault()
    if (!autorizadoParaEditarPermisos) return
    if (!nuevoNombre.trim() || !nuevoUsuario.trim() || !nuevaPassword.trim()) {
      if (mostrarToast) mostrarToast('Completa Nombre, Usuario y Contraseña', 'alerta')
      return
    }

    const usuarioLimpio = nuevoUsuario.trim().toLowerCase()
    const correoFinal = nuevoEmail.trim()
      ? nuevoEmail.trim().toLowerCase()
      : `${usuarioLimpio}@protemec.com`

    const nuevoPerfilPayload = {
      nombre: nuevoNombre.trim(),
      usuario: usuarioLimpio,
      password: nuevaPassword.trim(),
      email: correoFinal,
      rol: nuevoRol,
      permisos: {
        gerencia: { ver: false, editar: false },
        compras: { ver: nuevoRol === 'Compras' || nuevoRol === 'Dirección', editar: nuevoRol === 'Compras' },
        proyectos: { ver: true, editar: false },
        clientes: { ver: true, editar: false },
        ingenieria: { ver: nuevoRol === 'Ingeniería' || nuevoRol === 'Dirección', editar: nuevoRol === 'Ingeniería' },
        kanban: { ver: true, editar: nuevoRol !== 'Solo Lectura' },
        almacen: { ver: true, editar: nuevoRol === 'Almacén' },
        rh: { ver: false, editar: false },
        chatbot: { ver: true, editar: true },
        seguridad: { ver: false, editar: false },
        ia: {
          accesoTotalTablas: nuevoRol === 'Dirección',
          tablasPermitidas: [],
          busquedaEnLinea: false
        }
      }
    }

    try {
      setGuardandoDB(true)
      const res = await fetch(`${API_URL}/api/usuarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevoPerfilPayload)
      })
      const creado = await res.json()
      if (!res.ok) throw new Error(creado.error || 'No se pudo crear el perfil')

      setPerfilesUsuarios((prev) => [...prev, creado])
      setPerfilSeleccionadoId(creado.id)
      setNuevoNombre('')
      setNuevoUsuario('')
      setNuevaPassword('')
      setNuevoEmail('')
      setMostrarFormularioNuevo(false)
      if (mostrarToast) mostrarToast(`Perfil "${creado.nombre}" guardado en Azure SQL`)
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setGuardandoDB(false)
    }
  }

  const eliminarPerfilActual = async () => {
    if (!autorizadoParaEditarPermisos || !perfilActivo) return
    if (perfilesUsuarios.length <= 1) {
      if (mostrarToast) mostrarToast('Debe existir al menos un perfil operativo en el sistema', 'alerta')
      return
    }

    try {
      setGuardandoDB(true)
      const res = await fetch(`${API_URL}/api/usuarios/${perfilActivo.id}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('No se pudo eliminar el perfil de la base de datos')

      const filtrados = perfilesUsuarios.filter((p) => p.id !== perfilActivo.id)
      setPerfilesUsuarios(filtrados)
      setPerfilSeleccionadoId(filtrados[0]?.id || null)
      if (mostrarToast) mostrarToast(`Perfil "${perfilActivo.nombre}" eliminado de Azure SQL`, 'alerta')
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setGuardandoDB(false)
    }
  }

  const guardarCredencialesEmergencia = async (e) => {
    e.preventDefault()
    if (!esMaestro || !credencialesMaestras?.id) return

    try {
      setGuardandoDB(true)
      const res = await fetch(`${API_URL}/api/usuarios/${credencialesMaestras.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...credencialesMaestras,
          usuario: userMaestroTemp.trim(),
          password: passMaestroTemp
        })
      })
      const actualizado = await res.json()
      if (!res.ok) throw new Error(actualizado.error || 'Error al actualizar cuenta maestra')

      setCredencialesMaestras(actualizado)
      if (mostrarToast) mostrarToast('Credenciales del Administrador Maestro actualizadas en Azure SQL')
      if (recargarDatos) recargarDatos()
    } catch (err) {
      if (mostrarToast) mostrarToast(err.message, 'error')
    } finally {
      setGuardandoDB(false)
    }
  }

  return createPortal(
    <div className="pro-modal-backdrop" onClick={alCerrar}>
      <div className="pro-modal-window" style={{ maxWidth: '940px' }} onClick={(e) => e.stopPropagation()}>
        {/* CABECERA */}
        <div className="pro-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🛡️</span>
            <div>
              <h3 style={{ fontSize: '16px', margin: 0 }}>
                Administración de Perfiles, Usuarios y Accesos (Azure SQL)
              </h3>
              <span style={{ fontSize: '12px', color: '#86868b' }}>
                Sesión actual: <strong>{usuarioActual?.nombre}</strong> ({usuarioActual?.usuario || usuarioActual?.email})
              </span>
            </div>
          </div>

          <button onClick={alCerrar} className="pro-btn pro-btn-secondary pro-btn-sm">✕</button>
        </div>

        {/* PESTAÑAS DE NAVEGACIÓN INTERNA */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-light)', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div className="pro-segmented">
            <button
              type="button"
              className={`pro-segmented-btn ${pestana === 'permisos' ? 'active' : ''}`}
              onClick={() => setPestana('permisos')}
            >
              🎛️ Perfiles, Usuarios y Permisos
            </button>
            {esMaestro && (
              <>
                <button
                  type="button"
                  className={`pro-segmented-btn ${pestana === 'emergencia' ? 'active' : ''}`}
                  onClick={() => setPestana('emergencia')}
                >
                  🔑 Cuenta Maestra (Admin)
                </button>
                <button
                  type="button"
                  className={`pro-segmented-btn ${pestana === 'entraid' ? 'active' : ''}`}
                  onClick={() => setPestana('entraid')}
                >
                  ☁️ Microsoft Entra ID y API
                </button>
              </>
            )}
          </div>

          {pestana === 'permisos' && autorizadoParaEditarPermisos && (
            <button
              type="button"
              onClick={() => setMostrarFormularioNuevo(!mostrarFormularioNuevo)}
              className={`pro-btn pro-btn-sm ${mostrarFormularioNuevo ? 'pro-btn-dark' : 'pro-btn-primary'}`}
            >
              {mostrarFormularioNuevo ? '✕ Cancelar Creación' : '➕ Crear Nuevo Perfil / Usuario'}
            </button>
          )}
        </div>

        <div className="pro-modal-body" style={{ minHeight: '460px' }}>
          {/* PESTAÑA 1: GESTIÓN DE PERFILES, CREDENCIALES Y PERMISOS */}
          {pestana === 'permisos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {mostrarFormularioNuevo && autorizadoParaEditarPermisos && (
                <form
                  onSubmit={crearNuevoPerfil}
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '14px',
                    padding: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '14.5px', color: '#0071e3', margin: 0 }}>
                      ➕ Dar de Alta Nuevo Perfil de Usuario en Azure SQL
                    </h4>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
                    <div>
                      <label className="pro-label">Nombre del Perfil / Persona *</label>
                      <input
                        type="text"
                        placeholder="Ej. Ing. Juan Pérez"
                        value={nuevoNombre}
                        onChange={(e) => setNuevoNombre(e.target.value)}
                        required
                        className="pro-input"
                      />
                    </div>

                    <div>
                      <label className="pro-label">Usuario para Acceder *</label>
                      <input
                        type="text"
                        placeholder="Ej. jperez"
                        value={nuevoUsuario}
                        onChange={(e) => setNuevoUsuario(e.target.value)}
                        required
                        className="pro-input pro-mono"
                      />
                    </div>

                    <div>
                      <label className="pro-label">Contraseña *</label>
                      <input
                        type="text"
                        placeholder="Ej. Prote2026*"
                        value={nuevaPassword}
                        onChange={(e) => setNuevaPassword(e.target.value)}
                        required
                        className="pro-input pro-mono"
                      />
                    </div>

                    <div>
                      <label className="pro-label">Correo Microsoft Entra (Opcional)</label>
                      <input
                        type="email"
                        placeholder="jperez@protemec.com"
                        value={nuevoEmail}
                        onChange={(e) => setNuevoEmail(e.target.value)}
                        className="pro-input pro-mono"
                      />
                    </div>

                    <div>
                      <label className="pro-label">Área / Rol</label>
                      <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value)} className="pro-select">
                        <option value="Producción / Taller">Producción / Taller (Solo Kanban)</option>
                        <option value="Ingeniería">Ingeniería (CAD 3D + Kanban)</option>
                        <option value="Compras">Compras</option>
                        <option value="Almacén">Almacén</option>
                        <option value="Dirección">Dirección</option>
                        <option value="Solo Lectura">Auditor (Solo Lectura)</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setMostrarFormularioNuevo(false)}
                      className="pro-btn pro-btn-secondary pro-btn-sm"
                    >
                      Cancelar
                    </button>
                    <button type="submit" disabled={guardandoDB} className="pro-btn pro-btn-success pro-btn-sm">
                      {guardandoDB ? 'Guardando...' : '💾 Guardar en Azure SQL'}
                    </button>
                  </div>
                </form>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '20px', alignItems: 'start' }}>
                <div style={{ borderRight: '1px solid var(--border-light)', paddingRight: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span className="pro-label">Selecciona un Perfil ({perfilesUsuarios.length})</span>

                  {perfilesUsuarios.map((p) => {
                    const activo = p.id === perfilActivo?.id
                    return (
                      <div
                        key={p.id}
                        onClick={() => setPerfilSeleccionadoId(p.id)}
                        style={{
                          padding: '11px 12px',
                          borderRadius: '10px',
                          border: `1px solid ${activo ? '#0071e3' : 'var(--border-light)'}`,
                          backgroundColor: activo ? 'rgba(0, 113, 227, 0.08)' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '13px', color: activo ? '#0071e3' : '#1d1d1f' }}>
                            {p.nombre}
                          </strong>
                        </div>
                        <div className="pro-mono" style={{ fontSize: '11px', color: '#515154', marginTop: '3px' }}>
                          👤 Usuario: <strong>{p.usuario}</strong>
                        </div>
                        <div className="pro-mono" style={{ fontSize: '10.5px', color: '#86868b' }}>
                          ✉️ {p.email}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {perfilActivo && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ backgroundColor: '#f8fafc', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                        <span className="pro-label" style={{ margin: 0, color: '#0071e3' }}>
                          Credenciales del Perfil Seleccionado
                        </span>

                        {autorizadoParaEditarPermisos && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              disabled={guardandoDB}
                              onClick={() => persistirPerfilEnSQL(perfilActivo, `Credenciales de "${perfilActivo.nombre}" actualizadas en Azure SQL`)}
                              className="pro-btn pro-btn-primary pro-btn-sm"
                            >
                              💾 Guardar Credenciales
                            </button>
                            <button
                              type="button"
                              disabled={guardandoDB}
                              onClick={eliminarPerfilActual}
                              className="pro-btn pro-btn-danger pro-btn-sm"
                            >
                              🗑️ Eliminar Perfil
                            </button>
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '10px' }}>
                        <div>
                          <label className="pro-label">Nombre del Perfil</label>
                          <input
                            type="text"
                            value={perfilActivo.nombre || ''}
                            disabled={!autorizadoParaEditarPermisos}
                            onChange={(e) => actualizarCampoPerfil('nombre', e.target.value)}
                            className="pro-input"
                            style={{ padding: '7px 10px', fontSize: '12.5px' }}
                          />
                        </div>
                        <div>
                          <label className="pro-label">Usuario de Acceso</label>
                          <input
                            type="text"
                            value={perfilActivo.usuario || ''}
                            disabled={!autorizadoParaEditarPermisos}
                            onChange={(e) => actualizarCampoPerfil('usuario', e.target.value)}
                            className="pro-input pro-mono"
                            style={{ padding: '7px 10px', fontSize: '12.5px', fontWeight: 700 }}
                          />
                        </div>
                        <div>
                          <label className="pro-label">Contraseña del Perfil</label>
                          <input
                            type="text"
                            value={perfilActivo.password || ''}
                            disabled={!autorizadoParaEditarPermisos}
                            onChange={(e) => actualizarCampoPerfil('password', e.target.value)}
                            className="pro-input pro-mono"
                            style={{ padding: '7px 10px', fontSize: '12.5px', color: '#059669', fontWeight: 700 }}
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <h4 style={{ fontSize: '14.5px', margin: 0 }}>
                        Permisos de Navegación y Edición para &ldquo;{perfilActivo.nombre}&rdquo;
                      </h4>
                    </div>

                    <div style={{ border: '1px solid var(--border-light)', borderRadius: '12px', overflow: 'hidden', backgroundColor: '#ffffff' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-light)' }}>
                            <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '11px', textTransform: 'uppercase', color: '#515154' }}>
                              Página / Módulo del ERP
                            </th>
                            <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '11px', textTransform: 'uppercase', color: '#515154', width: '130px' }}>
                              👁️ Ver Apartado
                            </th>
                            <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '11px', textTransform: 'uppercase', color: '#515154', width: '150px' }}>
                              ✏️ Editar / Dar Permisos
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {MODULOS_SISTEMA.map((mod) => {
                            const perm = perfilActivo.permisos?.[mod.id] || { ver: false, editar: false }
                            const esFilaSeguridad = mod.id === 'seguridad'
                            return (
                              <tr
                                key={mod.id}
                                style={{
                                  borderBottom: '1px solid rgba(0,0,0,0.04)',
                                  backgroundColor: esFilaSeguridad ? '#fffbeb' : 'transparent'
                                }}
                              >
                                <td style={{ padding: '10px 14px' }}>
                                  <div style={{ fontWeight: 600, color: esFilaSeguridad ? '#92400e' : '#1d1d1f' }}>
                                    {mod.label}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#86868b' }}>{mod.desc}</div>
                                </td>
                                <td style={{ textAlign: 'center', padding: '10px 14px' }}>
                                  <label className="apple-switch">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(perm.ver)}
                                      onChange={() => togglePermiso(mod.id, 'ver')}
                                      disabled={!autorizadoParaEditarPermisos}
                                    />
                                    <span className="apple-slider blue" />
                                  </label>
                                </td>
                                <td style={{ textAlign: 'center', padding: '10px 14px' }}>
                                  <label className="apple-switch">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(perm.editar)}
                                      onChange={() => togglePermiso(mod.id, 'editar')}
                                      disabled={!autorizadoParaEditarPermisos}
                                    />
                                    <span className="apple-slider" />
                                  </label>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* SECCIÓN DE PERMISOS DE INTELIGENCIA ARTIFICIAL (TABLAS SQL Y BÚSQUEDA EN LÍNEA) */}
                    {(() => {
                      const iaPerm = perfilActivo.permisos?.ia || {
                        accesoTotalTablas: true,
                        tablasPermitidas: [],
                        busquedaEnLinea: false
                      }
                      const accesoTotal = iaPerm.accesoTotalTablas !== false
                      const tablasSeleccionadas = Array.isArray(iaPerm.tablasPermitidas) ? iaPerm.tablasPermitidas : []

                      return (
                        <div style={{ border: '1px solid var(--border-light)', borderRadius: '12px', padding: '16px', backgroundColor: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <div>
                            <h4 style={{ fontSize: '14px', margin: '0 0 2px 0', color: '#1d1d1f' }}>
                              🤖 Permisos del Asistente IA para &ldquo;{perfilActivo.nombre}&rdquo;
                            </h4>
                            <p style={{ fontSize: '11.5px', color: '#6b7280', margin: 0 }}>
                              Controla qué tablas de Azure SQL puede leer la IA para este usuario y si puede responder con conocimiento externo.
                            </p>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={{ backgroundColor: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#1d1d1f' }}>
                                  🗄️ Acceso a todas las tablas SQL
                                </div>
                                <div style={{ fontSize: '11px', color: '#86868b' }}>
                                  {accesoTotal ? 'Puede consultar toda la base de datos' : `Restringido a ${tablasSeleccionadas.length} tabla(s)`}
                                </div>
                              </div>
                              <label className="apple-switch">
                                <input
                                  type="checkbox"
                                  checked={accesoTotal}
                                  onChange={() => toggleConfigIA('accesoTotalTablas')}
                                  disabled={!autorizadoParaEditarPermisos}
                                />
                                <span className="apple-slider blue" />
                              </label>
                            </div>

                            <div style={{ backgroundColor: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#1d1d1f' }}>
                                  🌐 Permitir búsqueda / respuestas externas
                                </div>
                                <div style={{ fontSize: '11px', color: '#86868b' }}>
                                  {iaPerm.busquedaEnLinea ? 'Puede usar conocimiento en línea además del ERP' : 'Solo datos internos de Azure SQL'}
                                </div>
                              </div>
                              <label className="apple-switch">
                                <input
                                  type="checkbox"
                                  checked={Boolean(iaPerm.busquedaEnLinea)}
                                  onChange={() => toggleConfigIA('busquedaEnLinea')}
                                  disabled={!autorizadoParaEditarPermisos}
                                />
                                <span className="apple-slider" />
                              </label>
                            </div>
                          </div>

                          {!accesoTotal && (
                            <div style={{ backgroundColor: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                                <span className="pro-label" style={{ margin: 0 }}>
                                  Tablas autorizadas en Azure SQL ({tablasSeleccionadas.length} / {tablasBD.length})
                                </span>
                                {autorizadoParaEditarPermisos && tablasBD.length > 0 && (
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                      type="button"
                                      disabled={guardandoDB}
                                      onClick={() => aplicarLoteTablasIA(true)}
                                      className="pro-btn pro-btn-secondary pro-btn-sm"
                                      style={{ fontSize: '11px', padding: '3px 8px' }}
                                    >
                                      Seleccionar todas
                                    </button>
                                    <button
                                      type="button"
                                      disabled={guardandoDB}
                                      onClick={() => aplicarLoteTablasIA(false)}
                                      className="pro-btn pro-btn-secondary pro-btn-sm"
                                      style={{ fontSize: '11px', padding: '3px 8px' }}
                                    >
                                      Ninguna
                                    </button>
                                  </div>
                                )}
                              </div>

                              {cargandoTablas ? (
                                <div style={{ fontSize: '12px', color: '#6b7280' }}>Cargando tablas de Azure SQL...</div>
                              ) : tablasBD.length === 0 ? (
                                <div style={{ fontSize: '12px', color: '#b45309' }}>
                                  No se pudo obtener la lista de tablas desde el servidor MCP (`{CHAT_API_URL}`).
                                </div>
                              ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '8px' }}>
                                  {tablasBD.map((tabla) => {
                                    const marcada = tablasSeleccionadas.includes(tabla)
                                    return (
                                      <label
                                        key={tabla}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '6px 10px',
                                          borderRadius: '8px',
                                          border: `1px solid ${marcada ? '#0071e3' : 'var(--border-light)'}`,
                                          backgroundColor: marcada ? 'rgba(0, 113, 227, 0.06)' : '#fafafa',
                                          cursor: autorizadoParaEditarPermisos ? 'pointer' : 'not-allowed',
                                          fontSize: '12px'
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={marcada}
                                          disabled={!autorizadoParaEditarPermisos}
                                          onChange={() => toggleTablaIA(tabla)}
                                        />
                                        <span className="pro-mono" style={{ fontWeight: marcada ? 700 : 500, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {tabla}
                                        </span>
                                      </label>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PESTAÑA 2: CUENTA MAESTRA DE ADMINISTRADOR */}
          {pestana === 'emergencia' && esMaestro && (
            <form onSubmit={guardarCredencialesEmergencia} style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '12.5px' }}>
                <strong>👑 Credenciales del Administrador Maestro:</strong> Este usuario se guarda con <code>EsMaestro = 1</code> en Azure SQL y tiene acceso total a todos los módulos.
              </div>

              <div>
                <label className="pro-label">Usuario Administrador Maestro</label>
                <input
                  type="text"
                  value={userMaestroTemp}
                  onChange={(e) => setUserMaestroTemp(e.target.value)}
                  required
                  className="pro-input pro-mono"
                />
              </div>

              <div>
                <label className="pro-label">Contraseña Maestra</label>
                <input
                  type="text"
                  value={passMaestroTemp}
                  onChange={(e) => setPassMaestroTemp(e.target.value)}
                  required
                  className="pro-input pro-mono"
                />
              </div>

              <button type="submit" disabled={guardandoDB} className="pro-btn pro-btn-primary">
                {guardandoDB ? 'Guardando en Azure SQL...' : '💾 Guardar Credenciales Maestras'}
              </button>
            </form>
          )}

          {/* PESTAÑA 3: MICROSOFT ENTRA ID Y ENDPOINT */}
          {pestana === 'entraid' && esMaestro && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ padding: '16px', borderRadius: '12px', backgroundColor: '#f8fafc', border: '1px solid var(--border-light)' }}>
                <h4 style={{ fontSize: '14px', marginBottom: '10px' }}>☁️ Parámetros de Microsoft Entra ID (Azure AD)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="pro-label">Tenant ID</label>
                    <input type="text" placeholder="protemec.onmicrosoft.com" className="pro-input pro-mono" />
                  </div>
                  <div>
                    <label className="pro-label">Client ID (App Registration)</label>
                    <input type="text" placeholder="00000000-0000-0000-0000-000000000000" className="pro-input pro-mono" />
                  </div>
                </div>
              </div>

              <div style={{ padding: '16px', borderRadius: '12px', backgroundColor: '#f5f5f7', border: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f' }}>Endpoint API Conectado</span>
                <code className="pro-mono" style={{ fontSize: '12.5px', color: '#0071e3', fontWeight: 700, wordBreak: 'break-all' }}>
                  {API_URL}
                </code>
              </div>
            </div>
          )}
        </div>

        <div className="pro-modal-footer">
          <button onClick={alCerrar} className="pro-btn pro-btn-primary">
            Listo
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}