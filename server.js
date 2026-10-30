import express from 'express'
import sql from 'mssql'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  StorageSharedKeyCredential
} from '@azure/storage-blob'

dotenv.config()

const app = express()
app.use(express.json())
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }))

const storage = multer.memoryStorage()
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } })

const uploadIngenieria = upload.fields([
  { name: 'archivoGlb', maxCount: 1 },
  { name: 'archivoPdf', maxCount: 1 }
])

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: { encrypt: true, trustServerCertificate: false }
}

// Contenedores dentro de tu cuenta de almacenamiento 'fotosurl'
const CONTAINER_COMPRAS = process.env.AZURE_CONTAINER_NAME || 'pruebacompras'
const CONTAINER_FOTOS_RH = process.env.AZURE_CONTAINER_FOTOS || 'foto-empleados'
const CONTAINER_DOCS_RH = process.env.AZURE_CONTAINER_DOCS || 'documentos-usuarios'

// -------------------------------------------------------------
// AUTO-VERIFICACIÃ“N DE COLUMNAS NUEVAS PARA KPIS, RH Y ALMACÃ‰N EN SQL
// -------------------------------------------------------------
async function asegurarColumnasRH() {
  try {
    let pool = await sql.connect(config)
    await pool.request().query(`
      IF OBJECT_ID('dbo.PersonalRH', 'U') IS NOT NULL
      BEGIN
        IF COL_LENGTH('dbo.PersonalRH', 'AplicaKPI') IS NULL
          ALTER TABLE dbo.PersonalRH ADD AplicaKPI BIT NOT NULL DEFAULT 1;

        IF COL_LENGTH('dbo.PersonalRH', 'FrecuenciaKPI') IS NULL
          ALTER TABLE dbo.PersonalRH ADD FrecuenciaKPI VARCHAR(20) NOT NULL DEFAULT 'MENSUAL';
      END

      IF OBJECT_ID('dbo.EvaluacionesKPI', 'U') IS NOT NULL
      BEGIN
        IF COL_LENGTH('dbo.EvaluacionesKPI', 'Frecuencia') IS NULL
          ALTER TABLE dbo.EvaluacionesKPI ADD Frecuencia VARCHAR(20) NOT NULL DEFAULT 'MENSUAL';

        IF COL_LENGTH('dbo.EvaluacionesKPI', 'AreaEvaluada') IS NULL
          ALTER TABLE dbo.EvaluacionesKPI ADD AreaEvaluada NVARCHAR(80) NULL;

        ALTER TABLE dbo.EvaluacionesKPI ALTER COLUMN PeriodoMes VARCHAR(30) NOT NULL;
      END

      IF OBJECT_ID('dbo.MovimientosAlmacen', 'U') IS NOT NULL
      BEGIN
        IF COL_LENGTH('dbo.MovimientosAlmacen', 'UsuarioERP') IS NULL
          ALTER TABLE dbo.MovimientosAlmacen ADD UsuarioERP NVARCHAR(150) NULL;

        IF COL_LENGTH('dbo.MovimientosAlmacen', 'FolioGrupo') IS NULL
          ALTER TABLE dbo.MovimientosAlmacen ADD FolioGrupo NVARCHAR(60) NULL;
      END

      IF OBJECT_ID('dbo.Ingenieria', 'U') IS NOT NULL
      BEGIN
        IF COL_LENGTH('dbo.Ingenieria', 'BitacoraConteoJSON') IS NULL
          ALTER TABLE dbo.Ingenieria ADD BitacoraConteoJSON NVARCHAR(MAX) NULL;
      END
    `)
    console.log('âœ… Esquema de RH, KPIs y AlmacÃ©n (UsuarioERP / FolioGrupo) verificado en Azure SQL')
  } catch (e) {
    console.warn('âš ï¸ Aviso al verificar columnas:', e.message)
  }
}
asegurarColumnasRH()

// -------------------------------------------------------------
// SUBIDA A BLOB STORAGE CON VIGENCIA DE 99 AÃ‘OS (IGUAL QUE COMPRAS)
// -------------------------------------------------------------
async function subirABlobYObtenerSAS(file, nombreContenedor = CONTAINER_COMPRAS) {
  if (!file) return null
  const connectionString = (process.env.AZURE_STORAGE_CONNECTION_STRING || '').trim()
  if (!connectionString) {
    throw new Error('Falta AZURE_STORAGE_CONNECTION_STRING en el archivo .env')
  }

  const containerName = (nombreContenedor || CONTAINER_COMPRAS).trim()
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blobName = `archivo_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
  const blockBlobClient = containerClient.getBlockBlobClient(blobName)

  await blockBlobClient.uploadData(file.buffer, {
    blobHTTPHeaders: { blobContentType: file.mimetype }
  })

  const accountName = blobServiceClient.accountName
  const matchKey = connectionString.match(/AccountKey=([^;]+)/)
  const accountKey = matchKey ? matchKey[1].replace(/["']/g, '').trim() : ''
  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey)

  const sasToken = generateBlobSASQueryParameters({
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse("r"),
    startsOn: new Date(),
    expiresOn: new Date(new Date().valueOf() + 99 * 365 * 24 * 60 * 60 * 1000)
  }, sharedKeyCredential).toString()

  return `${blockBlobClient.url}?${sasToken}`
}

// -------------------------------------------------------------
// VISOR INTERNO DE ARCHIVOS BLOB (EVITA ERROR XML DE PERMISOS/SAS)
// -------------------------------------------------------------
app.get('/api/blob-proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('URL requerida')

  try {
    const connectionString = (process.env.AZURE_STORAGE_CONNECTION_STRING || '').trim()
    if (!connectionString) {
      return res.redirect(url)
    }

    const parsedUrl = new URL(url)
    const segmentos = parsedUrl.pathname.split('/').filter(Boolean)
    if (segmentos.length < 2) {
      return res.redirect(url)
    }

    const containerName = decodeURIComponent(segmentos[0])
    const blobName = decodeURIComponent(segmentos.slice(1).join('/'))

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
    const containerClient = blobServiceClient.getContainerClient(containerName)
    const blobClient = containerClient.getBlobClient(blobName)

    const downloadResponse = await blobClient.download(0)
    const contentType = downloadResponse.contentType || 'application/octet-stream'

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `inline; filename="${blobName}"`)
    res.setHeader('Cache-Control', 'public, max-age=86400')

    downloadResponse.readableStreamBody.pipe(res)
  } catch (e) {
    res.status(500).send(`No se pudo cargar el archivo desde Azure Blob Storage: ${e.message}`)
  }
})

// Formatear usuario desde la tabla dbo.Usuarios
function formatearUsuarioDB(row) {
  let permisosParseados = {}
  try {
    permisosParseados = JSON.parse(row.PermisosJSON || '{}')
  } catch {
    permisosParseados = {}
  }

  return {
    id: row.ID,
    nombre: row.Nombre,
    usuario: row.Usuario,
    password: row.Password,
    email: row.Email || '',
    rol: row.Rol || 'Operaciones',
    esMaestro: Boolean(row.EsMaestro),
    permisos: {
      gerencia: permisosParseados.gerencia || { ver: false, editar: false },
      compras: permisosParseados.compras || { ver: false, editar: false },
      proyectos: permisosParseados.proyectos || { ver: false, editar: false },
      clientes: permisosParseados.clientes || { ver: false, editar: false },
      ingenieria: permisosParseados.ingenieria || { ver: false, editar: false },
      kanban: permisosParseados.kanban || { ver: false, editar: false },
      almacen: permisosParseados.almacen || { ver: false, editar: false },
      rh: permisosParseados.rh || { ver: false, editar: false },
      chatbot: permisosParseados.chatbot || { ver: false, editar: false },
      seguridad: permisosParseados.seguridad || { ver: false, editar: false }
    }
  }
}

// -------------------------------------------------------------
// 1. CLIENTES
// -------------------------------------------------------------
app.get('/api/clientes', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query('SELECT * FROM Clientes ORDER BY NombreCliente ASC')
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/clientes', async (req, res) => {
  const { nombreCliente, rfc } = req.body
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('N', nombreCliente)
      .input('R', rfc || null)
      .query('INSERT INTO Clientes (NombreCliente, RFC_TaxID) VALUES (@N, @R)')
    res.json({ mensaje: 'Guardado' })
  } catch (e) { res.status(500).send(e.message) }
})

// -------------------------------------------------------------
// 2. CONTACTOS DE CLIENTES
// -------------------------------------------------------------
app.get('/api/contactos', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query('SELECT ct.*, c.NombreCliente FROM ContactosClientes ct JOIN Clientes c ON ct.ClienteID = c.ClienteID')
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/contactos', async (req, res) => {
  const { clienteID, ubicacionID, nombreContacto, puesto, telefono, email } = req.body
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('ClienteID', sql.Int, parseInt(clienteID, 10))
      .input('UbicacionID', sql.Int, parseInt(ubicacionID, 10))
      .input('NombreContacto', sql.NVarChar, nombreContacto || '')
      .input('Puesto', sql.NVarChar, puesto || null)
      .input('Telefono', sql.NVarChar, telefono || null)
      .input('Email', sql.NVarChar, email || null)
      .query('INSERT INTO ContactosClientes (ClienteID, UbicacionID, NombreContacto, Puesto, Telefono, Email) VALUES (@ClienteID, @UbicacionID, @NombreContacto, @Puesto, @Telefono, @Email)')
    res.json({ mensaje: 'Contacto registrado correctamente' })
  } catch (e) { res.status(500).send(e.message) }
})

// -------------------------------------------------------------
// 3. UBICACIONES
// -------------------------------------------------------------
app.get('/api/ubicaciones', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query('SELECT * FROM Ubicaciones')
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/ubicaciones', async (req, res) => {
  const { clienteID, nombreUbicacion, direccion, ciudad } = req.body
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('ClienteID', sql.Int, parseInt(clienteID, 10))
      .input('NombreUbicacion', sql.NVarChar, nombreUbicacion || '')
      .input('Direccion', sql.NVarChar, direccion || null)
      .input('Ciudad', sql.NVarChar, ciudad || null)
      .query('INSERT INTO Ubicaciones (ClienteID, NombreUbicacion, Direccion, Ciudad) VALUES (@ClienteID, @NombreUbicacion, @Direccion, @Ciudad)')
    res.json({ mensaje: 'UbicaciÃ³n registrada correctamente' })
  } catch (e) { res.status(500).send(e.message) }
})

// -------------------------------------------------------------
// 4. PROYECTOS
// -------------------------------------------------------------
app.get('/api/proyectos', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query(`
      SELECT p.*, u.NombreUbicacion, c.NombreCliente, c.ClienteID 
      FROM Proyectos p 
      LEFT JOIN Ubicaciones u ON p.UbicacionID = u.UbicacionID 
      LEFT JOIN Clientes c ON u.ClienteID = c.ClienteID
    `)
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/proyectos', async (req, res) => {
  const { nombreProyecto, proyectoIdExterno, ubicacionID, descripcion, estatus } = req.body
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('NombreProyecto', sql.NVarChar, nombreProyecto || '')
      .input('ProyectoID_Externo', sql.VarChar, proyectoIdExterno || null)
      .input('UbicacionID', sql.Int, ubicacionID ? parseInt(ubicacionID, 10) : null)
      .input('Descripcion', sql.NVarChar, descripcion || null)
      .input('Estatus', sql.VarChar, estatus || 'Activo')
      .query(`
        INSERT INTO Proyectos (NombreProyecto, ProyectoID_Externo, UbicacionID, Descripcion, Estatus) 
        VALUES (@NombreProyecto, @ProyectoID_Externo, @UbicacionID, @Descripcion, @Estatus)
      `)
    res.json({ mensaje: 'Proyecto registrado correctamente' })
  } catch (e) { res.status(500).send(e.message) }
})

app.put('/api/proyectos/:id', async (req, res) => {
  const { id } = req.params
  const { nombreProyecto, proyectoIdExterno, ubicacionID, descripcion, estatus } = req.body
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('ID', parseInt(id, 10))
      .input('NombreProyecto', sql.NVarChar, nombreProyecto || '')
      .input('ProyectoID_Externo', sql.VarChar, proyectoIdExterno || null)
      .input('UbicacionID', sql.Int, ubicacionID ? parseInt(ubicacionID, 10) : null)
      .input('Descripcion', sql.NVarChar, descripcion || null)
      .input('Estatus', sql.VarChar, estatus || 'Activo')
      .query(`
        UPDATE Proyectos 
        SET NombreProyecto = @NombreProyecto, 
            ProyectoID_Externo = @ProyectoID_Externo, 
            UbicacionID = @UbicacionID, 
            Descripcion = @Descripcion, 
            Estatus = @Estatus 
        WHERE ProyectoID = @ID
      `)
    res.json({ mensaje: 'Proyecto actualizado correctamente' })
  } catch (e) { res.status(500).send(e.message) }
})

// -------------------------------------------------------------
// 5. COMPRAS
// -------------------------------------------------------------
app.get('/api/datos', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query('SELECT * FROM Compras ORDER BY FechaCreacion DESC')
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/compras', upload.single('archivo'), async (req, res) => {
  const { proveedor, costo, categoria, producto, proyecto, proyectoIdExterno, precioUnitario, cantidad, fechaCompra, estatus, material, notas } = req.body
  const estatusCompra = estatus || 'Pedido'
  const estatusAlmacen = estatusCompra === 'Comprado' ? 'Pendiente' : null

  try {
    let finalUrl = req.file ? await subirABlobYObtenerSAS(req.file, CONTAINER_COMPRAS) : null
    let pool = await sql.connect(config)
    let proyectoID = null

    if (proyecto && proyecto.trim() !== '') {
      let buscarProy = await pool.request()
        .input('Nombre', sql.NVarChar, proyecto.trim())
        .query('SELECT ProyectoID FROM Proyectos WHERE NombreProyecto = @Nombre')

      if (buscarProy.recordset.length > 0) {
        proyectoID = buscarProy.recordset[0].ProyectoID
      } else {
        let insertarProy = await pool.request()
          .input('Nombre', sql.NVarChar, proyecto.trim())
          .query(`
            INSERT INTO Proyectos (NombreProyecto, Estatus) VALUES (@Nombre, 'Activo');
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS ProyectoID;
          `)
        proyectoID = insertarProy.recordset[0].ProyectoID
      }
    }

    await pool.request()
      .input('P', proveedor)
      .input('C', costo)
      .input('Cat', categoria)
      .input('Prod', producto)
      .input('ProyText', proyecto || null)
      .input('ProyID', proyectoID)
      .input('ProyExt', proyectoIdExterno || null)
      .input('Mat', material || null)
      .input('Not', notas || null)
      .input('PU', precioUnitario)
      .input('Cant', cantidad)
      .input('URL', finalUrl)
      .input('E', estatusCompra)
      .input('EA', estatusAlmacen)
      .input('F', fechaCompra)
      .query(`INSERT INTO Compras (Proveedor, Costo, Categoria, Producto, Proyecto, ProyectoID, ProyectoID_Externo, Material, Notas, PrecioUnitario, Cantidad, URL_SaaS, FechaCompra, Estatus, EstatusAlmacen, FechaCreacion) 
              VALUES (@P, @C, @Cat, @Prod, @ProyText, @ProyID, @ProyExt, @Mat, @Not, @PU, @Cant, @URL, @F, @E, @EA, CAST(GETDATE() AS DATE))`)

    res.json({ mensaje: 'Guardado' })
  } catch (e) { res.status(500).send(e.message) }
})

app.put('/api/compras/:id', upload.single('archivo'), async (req, res) => {
  const { id } = req.params
  const { proveedor, costo, categoria, producto, proyecto, proyectoIdExterno, precioUnitario, cantidad, fechaCompra, urlSaaS, estatus, material, notas } = req.body

  try {
    let finalUrl = req.file ? await subirABlobYObtenerSAS(req.file, CONTAINER_COMPRAS) : urlSaaS
    let pool = await sql.connect(config)
    let actual = await pool.request().input('ID', parseInt(id)).query('SELECT EstatusAlmacen FROM Compras WHERE Numero = @ID')
    let ea = actual.recordset[0]?.EstatusAlmacen

    if (estatus === 'Comprado' && (ea === null || ea === '')) {
      ea = 'Pendiente'
    }

    let proyectoID = null

    if (proyecto && proyecto.trim() !== '') {
      let buscarProy = await pool.request()
        .input('Nombre', sql.NVarChar, proyecto.trim())
        .query('SELECT ProyectoID FROM Proyectos WHERE NombreProyecto = @Nombre')

      if (buscarProy.recordset.length > 0) {
        proyectoID = buscarProy.recordset[0].ProyectoID
      } else {
        let insertarProy = await pool.request()
          .input('Nombre', sql.NVarChar, proyecto.trim())
          .query(`
            INSERT INTO Proyectos (NombreProyecto, Estatus) VALUES (@Nombre, 'Activo');
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS ProyectoID;
          `)
        proyectoID = insertarProy.recordset[0].ProyectoID
      }
    }

    await pool.request()
      .input('ID', parseInt(id))
      .input('P', proveedor)
      .input('C', costo)
      .input('Cat', categoria)
      .input('Prod', producto)
      .input('ProyText', proyecto || null)
      .input('ProyID', proyectoID)
      .input('ProyExt', proyectoIdExterno || null)
      .input('Mat', material || null)
      .input('Not', notas || null)
      .input('PU', precioUnitario)
      .input('Cant', cantidad)
      .input('URL', finalUrl)
      .input('E', estatus)
      .input('EA', ea)
      .input('F', fechaCompra)
      .query(`UPDATE Compras SET Proveedor=@P, Costo=@C, Categoria=@Cat, Producto=@Prod, Proyecto=@ProyText, ProyectoID=@ProyID, ProyectoID_Externo=@ProyExt, Material=@Mat, Notas=@Not, PrecioUnitario=@PU, 
              Cantidad=@Cant, URL_SaaS=@URL, FechaCompra=@F, Estatus=@E, EstatusAlmacen=@EA WHERE Numero=@ID`)

    res.json({ mensaje: 'Actualizado' })
  } catch (e) { res.status(500).send(e.message) }
})

app.put('/api/compras/cancelar/:id', async (req, res) => {
  const { id } = req.params
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('ID', parseInt(id))
      .query("UPDATE Compras SET Estatus = 'Cancelado' WHERE Numero = @ID")
    res.json({ mensaje: 'Cancelado correctamente' })
  } catch (e) {
    res.status(500).send(e.message)
  }
})

// -------------------------------------------------------------
// 6. INGENIERÃA (Alta, Consulta, EdiciÃ³n y Avance)
// -------------------------------------------------------------
app.get('/api/ingenieria', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query('SELECT * FROM Ingenieria ORDER BY FechaCreacion DESC')
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/ingenieria', uploadIngenieria, async (req, res) => {
  const { nombre, proyecto, tipoNivel, padreID, cantidadRequerida, cantidadLista, bitacoraConteo } = req.body

  try {
    let urlGLB = req.files?.archivoGlb ? await subirABlobYObtenerSAS(req.files.archivoGlb[0], CONTAINER_COMPRAS) : null
    let urlPDF = req.files?.archivoPdf ? await subirABlobYObtenerSAS(req.files.archivoPdf[0], CONTAINER_COMPRAS) : null

    let pool = await sql.connect(config)
    const cr = parseInt(cantidadRequerida, 10) || 1
    const cl = parseInt(cantidadLista, 10) || 0

    if (bitacoraConteo) {
      try {
        await pool.request()
          .input('N', sql.NVarChar, nombre || '')
          .input('P', sql.NVarChar, proyecto || '')
          .input('TN', sql.VarChar, tipoNivel || 'Pieza')
          .input('PID', padreID && padreID !== '' ? parseInt(padreID, 10) : null)
          .input('CR', sql.Int, cr)
          .input('CL', sql.Int, cl)
          .input('GLB', urlGLB)
          .input('PDF', urlPDF)
          .input('BC', sql.NVarChar, typeof bitacoraConteo === 'string' ? bitacoraConteo : JSON.stringify(bitacoraConteo))
          .query(`
            INSERT INTO Ingenieria 
              (Nombre, Proyecto, TipoNivel, PadreID, CantidadRequerida, CantidadLista, UrlGLB, UrlPDF, EstatusAvance, FechaCreacion, BitacoraConteoJSON) 
            VALUES 
              (@N, @P, @TN, @PID, @CR, @CL, @GLB, @PDF, 'Pendiente', GETDATE(), @BC)
          `)
        return res.json({ mensaje: 'Guardado correctamente' })
      } catch (errBc) {
        console.warn('Fallo al guardar con BitacoraConteoJSON, reintentando:', errBc.message)
      }
    }

    await pool.request()
      .input('N', sql.NVarChar, nombre || '')
      .input('P', sql.NVarChar, proyecto || '')
      .input('TN', sql.VarChar, tipoNivel || 'Pieza')
      .input('PID', padreID && padreID !== '' ? parseInt(padreID, 10) : null)
      .input('CR', sql.Int, cr)
      .input('CL', sql.Int, cl)
      .input('GLB', urlGLB)
      .input('PDF', urlPDF)
      .query(`
        INSERT INTO Ingenieria 
          (Nombre, Proyecto, TipoNivel, PadreID, CantidadRequerida, CantidadLista, UrlGLB, UrlPDF, EstatusAvance, FechaCreacion) 
        VALUES 
          (@N, @P, @TN, @PID, @CR, @CL, @GLB, @PDF, 'Pendiente', GETDATE())
      `)
    res.json({ mensaje: 'Guardado' })
  } catch (e) {
    res.status(500).send(e.message)
  }
})

app.put('/api/ingenieria/:id', uploadIngenieria, async (req, res) => {
  const { id } = req.params
  const { nombre, proyecto, tipoNivel, padreID, cantidadRequerida, urlGlbActual, urlPdfActual } = req.body

  try {
    let urlGLB = req.files?.archivoGlb ? await subirABlobYObtenerSAS(req.files.archivoGlb[0], CONTAINER_COMPRAS) : (urlGlbActual || null)
    let urlPDF = req.files?.archivoPdf ? await subirABlobYObtenerSAS(req.files.archivoPdf[0], CONTAINER_COMPRAS) : (urlPdfActual || null)

    let pool = await sql.connect(config)
    await pool.request()
      .input('ID', parseInt(id, 10))
      .input('N', sql.NVarChar, nombre || '')
      .input('P', sql.NVarChar, proyecto || '')
      .input('TN', sql.VarChar, tipoNivel || 'Ensamble')
      .input('PID', padreID && padreID !== '' ? parseInt(padreID, 10) : null)
      .input('CR', sql.Int, parseInt(cantidadRequerida, 10) || 1)
      .input('GLB', urlGLB)
      .input('PDF', urlPDF)
      .query(`
        UPDATE Ingenieria 
        SET Nombre = @N, 
            Proyecto = @P, 
            TipoNivel = @TN, 
            PadreID = @PID, 
            CantidadRequerida = @CR, 
            UrlGLB = @GLB, 
            UrlPDF = @PDF 
        WHERE ID = @ID
      `)
    res.json({ mensaje: 'Actualizado correctamente' })
  } catch (e) {
    res.status(500).send(e.message)
  }
})

app.put('/api/ingenieria/:id/avance', async (req, res) => {
  const { id } = req.params
  const { cantidadLista, cantidadRequerida, bitacoraConteo } = req.body

  try {
    let pool = await sql.connect(config)

    if (bitacoraConteo !== undefined) {
      try {
        await pool.request()
          .input('ID', sql.Int, parseInt(id, 10))
          .input('CL', sql.Int, parseInt(cantidadLista, 10) || 0)
          .input('CR', sql.Int, parseInt(cantidadRequerida, 10) || 1)
          .input('BC', sql.NVarChar, typeof bitacoraConteo === 'string' ? bitacoraConteo : JSON.stringify(bitacoraConteo))
          .query(`
            UPDATE Ingenieria 
            SET CantidadLista = @CL, 
                CantidadRequerida = @CR,
                BitacoraConteoJSON = @BC 
            WHERE ID = @ID
          `)
        return res.json({ mensaje: 'Avance y bitácora de conteo actualizados correctamente' })
      } catch (errBc) {
        console.warn('BitacoraConteoJSON no disponible en SQL, actualizando sin bitácora:', errBc.message)
      }
    }

    await pool.request()
      .input('ID', sql.Int, parseInt(id, 10))
      .input('CL', sql.Int, parseInt(cantidadLista, 10) || 0)
      .input('CR', sql.Int, parseInt(cantidadRequerida, 10) || 1)
      .query(`
        UPDATE Ingenieria 
        SET CantidadLista = @CL, 
            CantidadRequerida = @CR 
        WHERE ID = @ID
      `)
    res.json({ mensaje: 'Avance actualizado correctamente' })
  } catch (e) {
    res.status(500).send(e.message)
  }
})

// -------------------------------------------------------------
// 7. ALMACÃ‰N, INVENTARIO, SALIDAS, KITS EN GRUPO Y PRÃ‰STAMOS
// -------------------------------------------------------------
app.get('/api/inventario', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query('SELECT * FROM InventarioAlmacen ORDER BY ID DESC')
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.get('/api/inventario/movimientos', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query(`
      SELECT m.*, p.Departamento, p.Puesto, p.Activo AS EmpleadoActivo
      FROM MovimientosAlmacen m
      LEFT JOIN PersonalRH p ON m.EmpleadoID = p.EmpleadoID
      ORDER BY m.FechaMovimiento DESC
    `)
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/inventario/ingresar', async (req, res) => {
  const { compraID, modo, inventarioIDExistente, nombreProducto, ubicacion3D, cantidad, notas, usuarioERP } = req.body
  const cantNum = parseInt(cantidad, 10) || 1
  const operadorSesion = (usuarioERP || '').trim() || 'Operador AlmacÃ©n'

  try {
    let pool = await sql.connect(config)
    let tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      let targetID = inventarioIDExistente ? parseInt(inventarioIDExistente, 10) : null
      let nombreFinal = (nombreProducto || '').trim()

      if (modo === 'nuevo' || !targetID) {
        let r = await tx.request()
          .input('N', sql.NVarChar, nombreFinal)
          .input('U', sql.NVarChar, ubicacion3D || 'Pieza1')
          .input('S', sql.Int, cantNum)
          .query(`
            INSERT INTO InventarioAlmacen (NombreProducto, Ubicacion3D, Estado, CantidadStock, FechaActualizacion) 
            VALUES (@N, @U, 'Almacenado', @S, SYSDATETIME());
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS NuevoID;
          `)
        targetID = r.recordset[0].NuevoID
      } else {
        await tx.request()
          .input('ID', sql.Int, targetID)
          .input('S', sql.Int, cantNum)
          .input('U', sql.NVarChar, ubicacion3D || null)
          .query(`
            UPDATE InventarioAlmacen 
            SET CantidadStock = ISNULL(CantidadStock, 0) + @S, 
                Ubicacion3D = COALESCE(@U, Ubicacion3D),
                Estado = 'Almacenado',
                FechaActualizacion = SYSDATETIME()
            WHERE ID = @ID
          `)

        let rProd = await tx.request()
          .input('ID', sql.Int, targetID)
          .query('SELECT NombreProducto FROM InventarioAlmacen WHERE ID = @ID')
        if (rProd.recordset.length > 0) {
          nombreFinal = rProd.recordset[0].NombreProducto
        }
      }

      if (compraID) {
        await tx.request()
          .input('CID', sql.Int, parseInt(compraID, 10))
          .input('IID', sql.Int, targetID)
          .input('C', sql.Int, cantNum)
          .query('INSERT INTO DetalleRecepcionCompras (CompraID, InventarioID, CantidadRecibida) VALUES (@CID, @IID, @C)')

        await tx.request()
          .input('ID', sql.Int, parseInt(compraID, 10))
          .query("UPDATE Compras SET EstatusAlmacen = 'Recibido en AlmacÃ©n' WHERE Numero = @ID")
      }

      await tx.request()
        .input('IID', sql.Int, targetID)
        .input('NP', sql.NVarChar, nombreFinal || 'ArtÃ­culo')
        .input('TM', sql.VarChar, compraID ? 'Recepcion Compra' : 'Entrada Manual')
        .input('Cant', sql.Int, cantNum)
        .input('Not', sql.NVarChar, notas || (compraID ? `Ingreso desde Compra #${compraID}` : 'Alta / suma directa en almacÃ©n'))
        .input('UERP', sql.NVarChar, operadorSesion)
        .query(`
          IF OBJECT_ID('dbo.MovimientosAlmacen', 'U') IS NOT NULL
          BEGIN
            INSERT INTO MovimientosAlmacen (InventarioID, NombreProducto, TipoMovimiento, Cantidad, Notas, UsuarioERP)
            VALUES (@IID, @NP, @TM, @Cant, @Not, @UERP)
          END
        `)

      await tx.commit()
      res.json({ success: true, id: targetID })
    } catch (err) {
      await tx.rollback()
      throw err
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/inventario/salida', async (req, res) => {
  const { inventarioID, tipoMovimiento, cantidad, empleadoID, proyecto, notas, usuarioERP } = req.body
  const cantSalida = parseInt(cantidad, 10) || 1
  const operadorSesion = (usuarioERP || '').trim() || 'Operador AlmacÃ©n'

  try {
    let pool = await sql.connect(config)
    let tx = new sql.Transaction(pool)
    await tx.begin()

    try {
      let empRes = await tx.request()
        .input('EID', sql.Int, parseInt(empleadoID, 10))
        .query('SELECT EmpleadoID, NombreCompleto, Activo FROM PersonalRH WHERE EmpleadoID = @EID')

      if (empRes.recordset.length === 0 || !empRes.recordset[0].Activo) {
        throw new Error('El colaborador seleccionado no existe o estÃ¡ dado de baja en RH.')
      }
      const empleado = empRes.recordset[0]

      let invRes = await tx.request()
        .input('IID', sql.Int, parseInt(inventarioID, 10))
        .query('SELECT ID, NombreProducto, CantidadStock FROM InventarioAlmacen WHERE ID = @IID')

      if (invRes.recordset.length === 0) {
        throw new Error('El artÃ­culo no existe en el inventario.')
      }
      const item = invRes.recordset[0]
      if (item.CantidadStock < cantSalida) {
        throw new Error(`Stock insuficiente para "${item.NombreProducto}". Disponible: ${item.CantidadStock}`)
      }

      const nuevoStock = item.CantidadStock - cantSalida
      const esPrestamo = tipoMovimiento === 'Prestamo Herramienta'
      const nuevoEstadoItem = nuevoStock === 0
        ? (esPrestamo ? 'En PrÃ©stamo' : 'Agotado')
        : 'Almacenado'

      await tx.request()
        .input('IID', sql.Int, item.ID)
        .input('NuevoStock', sql.Int, nuevoStock)
        .input('Estado', sql.NVarChar, nuevoEstadoItem)
        .query(`
          UPDATE InventarioAlmacen
          SET CantidadStock = @NuevoStock,
              Estado = @Estado,
              FechaActualizacion = SYSDATETIME()
          WHERE ID = @IID
        `)

      await tx.request()
        .input('IID', sql.Int, item.ID)
        .input('NP', sql.NVarChar, item.NombreProducto)
        .input('TM', sql.VarChar, esPrestamo ? 'Prestamo Herramienta' : 'Salida Consumo')
        .input('Cant', sql.Int, cantSalida)
        .input('EID', sql.Int, empleado.EmpleadoID)
        .input('NEmp', sql.NVarChar, empleado.NombreCompleto)
        .input('Proy', sql.NVarChar, proyecto || null)
        .input('Not', sql.NVarChar, notas || null)
        .input('EstP', sql.VarChar, esPrestamo ? 'Prestado' : null)
        .input('UERP', sql.NVarChar, operadorSesion)
        .query(`
          INSERT INTO MovimientosAlmacen
            (InventarioID, NombreProducto, TipoMovimiento, Cantidad, EmpleadoID, NombreEmpleado, Proyecto, Notas, EstatusPrestamo, UsuarioERP)
          VALUES
            (@IID, @NP, @TM, @Cant, @EID, @NEmp, @Proy, @Not, @EstP, @UERP)
        `)

      await tx.commit()
      res.json({ mensaje: esPrestamo ? 'PrÃ©stamo de herramienta registrado' : 'Salida de almacÃ©n registrada' })
    } catch (err) {
      await tx.rollback()
      return res.status(400).json({ error: err.message })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/inventario/salida-grupo', async (req, res) => {
  const { empleadoID, proyecto, sitioTrabajo, notasGenerales, usuarioERP, items } = req.body
  const operadorSesion = (usuarioERP || '').trim() || 'Operador AlmacÃ©n'

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debes incluir al menos un artÃ­culo en el envÃ­o en grupo.' })
  }

  try {
    let pool = await sql.connect(config)
    let tx = new sql.Transaction(pool)
    await tx.begin()

    try {
      let empRes = await tx.request()
        .input('EID', sql.Int, parseInt(empleadoID, 10))
        .query('SELECT EmpleadoID, NombreCompleto, Activo FROM PersonalRH WHERE EmpleadoID = @EID')

      if (empRes.recordset.length === 0 || !empRes.recordset[0].Activo) {
        throw new Error('El colaborador responsable no existe o estÃ¡ dado de baja en RH.')
      }
      const empleado = empRes.recordset[0]
      const folioGrupo = `SITIO-${Date.now().toString().slice(-6)}`
      const destinoFinal = [proyecto, sitioTrabajo].filter(Boolean).join(' Â· ') || 'Sitio Externo'

      for (const partida of items) {
        const cantSalida = parseInt(partida.cantidad, 10) || 1
        let invRes = await tx.request()
          .input('IID', sql.Int, parseInt(partida.inventarioID, 10))
          .query('SELECT ID, NombreProducto, CantidadStock FROM InventarioAlmacen WHERE ID = @IID')

        if (invRes.recordset.length === 0) {
          throw new Error(`El artÃ­culo #${partida.inventarioID} no existe.`)
        }
        const itemBD = invRes.recordset[0]
        if (itemBD.CantidadStock < cantSalida) {
          throw new Error(`Stock insuficiente para "${itemBD.NombreProducto}". Disponible: ${itemBD.CantidadStock}`)
        }

        const nuevoStock = itemBD.CantidadStock - cantSalida
        const esPrestamo = partida.tipoMovimiento === 'Prestamo Herramienta'
        const nuevoEstadoItem = nuevoStock === 0
          ? (esPrestamo ? 'En PrÃ©stamo' : 'Agotado')
          : 'Almacenado'

        await tx.request()
          .input('IID', sql.Int, itemBD.ID)
          .input('NuevoStock', sql.Int, nuevoStock)
          .input('Estado', sql.NVarChar, nuevoEstadoItem)
          .query(`
            UPDATE InventarioAlmacen
            SET CantidadStock = @NuevoStock,
                Estado = @Estado,
                FechaActualizacion = SYSDATETIME()
            WHERE ID = @IID
          `)

        await tx.request()
          .input('IID', sql.Int, itemBD.ID)
          .input('NP', sql.NVarChar, itemBD.NombreProducto)
          .input('TM', sql.VarChar, esPrestamo ? 'Prestamo Herramienta' : 'Salida Consumo')
          .input('Cant', sql.Int, cantSalida)
          .input('EID', sql.Int, empleado.EmpleadoID)
          .input('NEmp', sql.NVarChar, empleado.NombreCompleto)
          .input('Proy', sql.NVarChar, destinoFinal)
          .input('Not', sql.NVarChar, notasGenerales || `EnvÃ­o en grupo ${folioGrupo}`)
          .input('EstP', sql.VarChar, esPrestamo ? 'Prestado' : null)
          .input('UERP', sql.NVarChar, operadorSesion)
          .input('FG', sql.NVarChar, folioGrupo)
          .query(`
            INSERT INTO MovimientosAlmacen
              (InventarioID, NombreProducto, TipoMovimiento, Cantidad, EmpleadoID, NombreEmpleado, Proyecto, Notas, EstatusPrestamo, UsuarioERP, FolioGrupo)
            VALUES
              (@IID, @NP, @TM, @Cant, @EID, @NEmp, @Proy, @Not, @EstP, @UERP, @FG)
          `)
      }

      await tx.commit()
      res.json({ mensaje: `Kit ${folioGrupo} despachado correctamente (${items.length} partidas)`, folioGrupo })
    } catch (err) {
      await tx.rollback()
      return res.status(400).json({ error: err.message })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/inventario/prestamo/:movimientoId/devolver', async (req, res) => {
  const { movimientoId } = req.params
  const { notasDevolucion, usuarioERP } = req.body

  try {
    let pool = await sql.connect(config)
    let tx = new sql.Transaction(pool)
    await tx.begin()

    try {
      let movRes = await tx.request()
        .input('MID', sql.Int, parseInt(movimientoId, 10))
        .query('SELECT * FROM MovimientosAlmacen WHERE MovimientoID = @MID')

      if (movRes.recordset.length === 0) {
        throw new Error('Registro de prÃ©stamo no encontrado.')
      }
      const mov = movRes.recordset[0]
      if (mov.EstatusPrestamo === 'Devuelto') {
        throw new Error('Esta herramienta ya fue marcada como devuelta anteriormente.')
      }

      await tx.request()
        .input('MID', sql.Int, mov.MovimientoID)
        .input('Not', sql.NVarChar, notasDevolucion ? `${mov.Notas || ''} | Devuelto: ${notasDevolucion}` : mov.Notas)
        .input('UERP', sql.NVarChar, usuarioERP || mov.UsuarioERP || null)
        .query(`
          UPDATE MovimientosAlmacen
          SET EstatusPrestamo = 'Devuelto',
              FechaDevolucion = GETDATE(),
              Notas = @Not,
              UsuarioERP = COALESCE(UsuarioERP, @UERP)
          WHERE MovimientoID = @MID
        `)

      await tx.request()
        .input('IID', sql.Int, mov.InventarioID)
        .input('Cant', sql.Int, mov.Cantidad)
        .query(`
          UPDATE InventarioAlmacen
          SET CantidadStock = ISNULL(CantidadStock, 0) + @Cant,
              Estado = 'Almacenado',
              FechaActualizacion = SYSDATETIME()
          WHERE ID = @IID
        `)

      await tx.commit()
      res.json({ mensaje: 'Herramienta devuelta y sumada nuevamente al stock' })
    } catch (err) {
      await tx.rollback()
      return res.status(400).json({ error: err.message })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/inventario/prestamo-grupo/:folioGrupo/devolver', async (req, res) => {
  const { folioGrupo } = req.params
  const { usuarioERP } = req.body

  try {
    let pool = await sql.connect(config)
    let tx = new sql.Transaction(pool)
    await tx.begin()

    try {
      let movsRes = await tx.request()
        .input('FG', sql.NVarChar, folioGrupo)
        .query("SELECT * FROM MovimientosAlmacen WHERE FolioGrupo = @FG AND EstatusPrestamo = 'Prestado'")

      if (movsRes.recordset.length === 0) {
        throw new Error('No hay herramientas pendientes por devolver en este kit.')
      }

      for (const mov of movsRes.recordset) {
        await tx.request()
          .input('MID', sql.Int, mov.MovimientoID)
          .input('Not', sql.NVarChar, `${mov.Notas || ''} | Kit devuelto completo`)
          .input('UERP', sql.NVarChar, usuarioERP || mov.UsuarioERP || null)
          .query(`
            UPDATE MovimientosAlmacen
            SET EstatusPrestamo = 'Devuelto',
                FechaDevolucion = GETDATE(),
                Notas = @Not,
                UsuarioERP = COALESCE(UsuarioERP, @UERP)
            WHERE MovimientoID = @MID
          `)

        await tx.request()
          .input('IID', sql.Int, mov.InventarioID)
          .input('Cant', sql.Int, mov.Cantidad)
          .query(`
            UPDATE InventarioAlmacen
            SET CantidadStock = ISNULL(CantidadStock, 0) + @Cant,
                Estado = 'Almacenado',
                FechaActualizacion = SYSDATETIME()
            WHERE ID = @IID
          `)
      }

      await tx.commit()
      res.json({ mensaje: `Kit ${folioGrupo} reintegrado completo al almacÃ©n` })
    } catch (err) {
      await tx.rollback()
      return res.status(400).json({ error: err.message })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// -------------------------------------------------------------
// 8. USUARIOS, LOGIN Y SEGURIDAD RBAC
// -------------------------------------------------------------
app.get('/api/usuarios', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query('SELECT * FROM Usuarios ORDER BY EsMaestro DESC, ID ASC')
    res.json(r.recordset.map(formatearUsuarioDB))
  } catch (e) {
    res.status(500).send(e.message)
  }
})

app.post('/api/login', async (req, res) => {
  const { modo, usuario, password, email } = req.body
  try {
    let pool = await sql.connect(config)

    if (modo === 'entra') {
      const correoLimpio = (email || '').trim().toLowerCase()
      let r = await pool.request()
        .input('Email', sql.NVarChar, correoLimpio)
        .query('SELECT * FROM Usuarios WHERE LOWER(Email) = @Email')

      if (r.recordset.length === 0) {
        return res.status(401).json({ error: 'Este correo corporativo no estÃ¡ registrado. Solicita acceso al Administrador.' })
      }
      return res.json(formatearUsuarioDB(r.recordset[0]))
    } else {
      const uLimpio = (usuario || '').trim().toLowerCase()
      let r = await pool.request()
        .input('U', sql.NVarChar, uLimpio)
        .input('P', sql.NVarChar, password || '')
        .query('SELECT * FROM Usuarios WHERE (LOWER(Usuario) = @U OR LOWER(Email) = @U) AND Password = @P')

      if (r.recordset.length === 0) {
        return res.status(401).json({ error: 'Usuario o contraseÃ±a incorrectos' })
      }
      return res.json(formatearUsuarioDB(r.recordset[0]))
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/usuarios', async (req, res) => {
  const { nombre, usuario, password, email, rol, permisos } = req.body
  try {
    let pool = await sql.connect(config)
    const uLimpio = (usuario || '').trim().toLowerCase()

    let existe = await pool.request()
      .input('U', sql.NVarChar, uLimpio)
      .query('SELECT ID FROM Usuarios WHERE LOWER(Usuario) = @U')

    if (existe.recordset.length > 0) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya estÃ¡ registrado en la base de datos' })
    }

    let r = await pool.request()
      .input('Nombre', sql.NVarChar, (nombre || '').trim())
      .input('Usuario', sql.NVarChar, uLimpio)
      .input('Password', sql.NVarChar, (password || '').trim())
      .input('Email', sql.NVarChar, (email || `${uLimpio}@protemec.com`).trim().toLowerCase())
      .input('Rol', sql.NVarChar, rol || 'Operaciones')
      .input('PermisosJSON', sql.NVarChar, JSON.stringify(permisos || {}))
      .query(`
        INSERT INTO Usuarios (Nombre, Usuario, Password, Email, Rol, EsMaestro, PermisosJSON)
        OUTPUT INSERTED.*
        VALUES (@Nombre, @Usuario, @Password, @Email, @Rol, 0, @PermisosJSON)
      `)

    res.json(formatearUsuarioDB(r.recordset[0]))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params
  const { nombre, usuario, password, email, rol, permisos } = req.body
  try {
    let pool = await sql.connect(config)
    const uLimpio = (usuario || '').trim().toLowerCase()

    let duplicado = await pool.request()
      .input('U', sql.NVarChar, uLimpio)
      .input('ID', sql.Int, parseInt(id, 10))
      .query('SELECT ID FROM Usuarios WHERE LOWER(Usuario) = @U AND ID <> @ID')

    if (duplicado.recordset.length > 0) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya estÃ¡ ocupado por otro perfil' })
    }

    let r = await pool.request()
      .input('ID', sql.Int, parseInt(id, 10))
      .input('Nombre', sql.NVarChar, (nombre || '').trim())
      .input('Usuario', sql.NVarChar, uLimpio)
      .input('Password', sql.NVarChar, password || '')
      .input('Email', sql.NVarChar, (email || '').trim().toLowerCase())
      .input('Rol', sql.NVarChar, rol || 'Operaciones')
      .input('PermisosJSON', sql.NVarChar, JSON.stringify(permisos || {}))
      .query(`
        UPDATE Usuarios
        SET Nombre = @Nombre,
            Usuario = @Usuario,
            Password = @Password,
            Email = @Email,
            Rol = @Rol,
            PermisosJSON = @PermisosJSON
        OUTPUT INSERTED.*
        WHERE ID = @ID
      `)

    if (r.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    res.json(formatearUsuarioDB(r.recordset[0]))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('ID', sql.Int, parseInt(id, 10))
      .query('DELETE FROM Usuarios WHERE ID = @ID AND EsMaestro = 0')
    res.json({ mensaje: 'Perfil eliminado de Azure SQL' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// -------------------------------------------------------------
// 9. RECURSOS HUMANOS (FOTOS EN 'foto-empleados' Y ARCHIVOS EN 'documentos-usuarios')
// -------------------------------------------------------------
app.get('/api/rh/personal', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query(`
      SELECT p.*,
        COALESCE(p.URL_SaaS, p.FotoURL) AS FotoActivaURL,
        (SELECT AVG(PromedioGlobal) FROM EvaluacionesKPI k WHERE k.EmpleadoID = p.EmpleadoID) AS PromedioHistoricoKPI,
        (SELECT COUNT(*) FROM MovimientosAlmacen m WHERE m.EmpleadoID = p.EmpleadoID AND m.EstatusPrestamo = 'Prestado') AS HerramientasPrestadas,
        (SELECT COUNT(*) FROM DocumentosEmpleadosRH d WHERE d.EmpleadoID = p.EmpleadoID AND d.Activo = 1) AS TotalDocumentos
      FROM PersonalRH p
      ORDER BY p.Activo DESC, p.NombreCompleto ASC
    `)
    res.json(r.recordset)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/rh/personal', upload.single('foto'), async (req, res) => {
  const { nombreCompleto, telefono, departamento, puesto, fechaInicio, fechaNacimiento, aplicaKPI, frecuenciaKPI } = req.body
  try {
    let urlSaaSFoto = req.file ? await subirABlobYObtenerSAS(req.file, CONTAINER_FOTOS_RH) : null
    let pool = await sql.connect(config)
    const flagAplicaKPI = aplicaKPI === 'false' || aplicaKPI === false || aplicaKPI === 0 ? 0 : 1

    let r = await pool.request()
      .input('Nombre', sql.NVarChar, (nombreCompleto || '').trim())
      .input('Tel', sql.NVarChar, telefono || null)
      .input('Dep', sql.NVarChar, departamento || 'Operaciones')
      .input('Puesto', sql.NVarChar, puesto || null)
      .input('FInicio', sql.Date, fechaInicio || new Date())
      .input('FNac', sql.Date, fechaNacimiento || null)
      .input('AplicaKPI', sql.Bit, flagAplicaKPI)
      .input('FrecKPI', sql.VarChar, frecuenciaKPI || 'MENSUAL')
      .input('URL', urlSaaSFoto)
      .query(`
        INSERT INTO PersonalRH (NombreCompleto, Telefono, Departamento, Puesto, FechaInicio, FechaNacimiento, Activo, AplicaKPI, FrecuenciaKPI, URL_SaaS, FotoURL)
        VALUES (@Nombre, @Tel, @Dep, @Puesto, @FInicio, @FNac, 1, @AplicaKPI, @FrecKPI, @URL, @URL);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS NuevoEmpleadoID;
      `)

    const nuevoId = r.recordset[0].NuevoEmpleadoID

    if (urlSaaSFoto) {
      await pool.request()
        .input('EID', sql.Int, nuevoId)
        .input('Titulo', sql.NVarChar, 'FotografÃ­a de Perfil Inicial')
        .input('Tipo', sql.NVarChar, 'FotografÃ­a de Perfil')
        .input('URL', urlSaaSFoto)
        .input('NombreOrig', sql.NVarChar, req.file.originalname)
        .query(`
          INSERT INTO DocumentosEmpleadosRH (EmpleadoID, TituloDocumento, TipoDocumento, FechaDocumento, URL_SaaS, ArchivoURL, NombreArchivo, Activo)
          VALUES (@EID, @Titulo, @Tipo, CAST(GETDATE() AS DATE), @URL, @URL, @NombreOrig, 1)
        `)
    }

    res.json({ EmpleadoID: nuevoId, URL_SaaS: urlSaaSFoto, mensaje: 'Colaborador registrado correctamente' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/rh/personal/:id', upload.single('foto'), async (req, res) => {
  const { id } = req.params
  const { nombreCompleto, telefono, departamento, puesto, fechaInicio, fechaNacimiento, activo, aplicaKPI, frecuenciaKPI, fechaSalida, motivoSalida, fotoUrlActual } = req.body
  try {
    let nuevaUrlSaaS = req.file ? await subirABlobYObtenerSAS(req.file, CONTAINER_FOTOS_RH) : (fotoUrlActual || null)
    let pool = await sql.connect(config)
    const estaActivo = activo === true || activo === 1 || activo === 'true'
    const flagAplicaKPI = aplicaKPI === 'false' || aplicaKPI === false || aplicaKPI === 0 ? 0 : 1
    const empIdNum = parseInt(id, 10)

    await pool.request()
      .input('ID', sql.Int, empIdNum)
      .input('Nombre', sql.NVarChar, (nombreCompleto || '').trim())
      .input('Tel', sql.NVarChar, telefono || null)
      .input('Dep', sql.NVarChar, departamento || 'Operaciones')
      .input('Puesto', sql.NVarChar, puesto || null)
      .input('FInicio', sql.Date, fechaInicio || null)
      .input('FNac', sql.Date, fechaNacimiento || null)
      .input('Activo', sql.Bit, estaActivo ? 1 : 0)
      .input('AplicaKPI', sql.Bit, flagAplicaKPI)
      .input('FrecKPI', sql.VarChar, frecuenciaKPI || 'MENSUAL')
      .input('FSalida', sql.Date, !estaActivo ? (fechaSalida || new Date()) : null)
      .input('Motivo', sql.NVarChar, !estaActivo ? (motivoSalida || null) : null)
      .input('URL', nuevaUrlSaaS)
      .query(`
        UPDATE PersonalRH
        SET NombreCompleto = @Nombre,
            Telefono = @Tel,
            Departamento = @Dep,
            Puesto = @Puesto,
            FechaInicio = @FInicio,
            FechaNacimiento = @FNac,
            Activo = @Activo,
            AplicaKPI = @AplicaKPI,
            FrecuenciaKPI = @FrecKPI,
            FechaSalida = @FSalida,
            MotivoSalida = @Motivo,
            URL_SaaS = COALESCE(@URL, URL_SaaS),
            FotoURL = COALESCE(@URL, FotoURL)
        WHERE EmpleadoID = @ID
      `)

    if (req.file && nuevaUrlSaaS) {
      await pool.request()
        .input('EID', sql.Int, empIdNum)
        .input('Titulo', sql.NVarChar, 'ActualizaciÃ³n de FotografÃ­a de Perfil')
        .input('Tipo', sql.NVarChar, 'FotografÃ­a de Perfil')
        .input('URL', nuevaUrlSaaS)
        .input('NombreOrig', sql.NVarChar, req.file.originalname)
        .query(`
          INSERT INTO DocumentosEmpleadosRH (EmpleadoID, TituloDocumento, TipoDocumento, FechaDocumento, URL_SaaS, ArchivoURL, NombreArchivo, Activo)
          VALUES (@EID, @Titulo, @Tipo, CAST(GETDATE() AS DATE), @URL, @URL, @NombreOrig, 1)
        `)
    }

    res.json({ EmpleadoID: empIdNum, URL_SaaS: nuevaUrlSaaS, mensaje: 'Expediente actualizado' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/rh/personal/:id/foto', upload.single('foto'), async (req, res) => {
  const { id } = req.params
  try {
    if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen vÃ¡lida' })
    const urlSaaSFoto = await subirABlobYObtenerSAS(req.file, CONTAINER_FOTOS_RH)
    const empIdNum = parseInt(id, 10)

    let pool = await sql.connect(config)
    await pool.request()
      .input('ID', sql.Int, empIdNum)
      .input('URL', urlSaaSFoto)
      .query('UPDATE PersonalRH SET URL_SaaS = @URL, FotoURL = @URL WHERE EmpleadoID = @ID')

    await pool.request()
      .input('EID', sql.Int, empIdNum)
      .input('Titulo', sql.NVarChar, 'FotografÃ­a de Empleado')
      .input('Tipo', sql.NVarChar, 'FotografÃ­a de Perfil')
      .input('URL', urlSaaSFoto)
      .input('NombreOrig', sql.NVarChar, req.file.originalname)
      .query(`
        INSERT INTO DocumentosEmpleadosRH (EmpleadoID, TituloDocumento, TipoDocumento, FechaDocumento, URL_SaaS, ArchivoURL, NombreArchivo, Activo)
        VALUES (@EID, @Titulo, @Tipo, CAST(GETDATE() AS DATE), @URL, @URL, @NombreOrig, 1)
      `)

    res.json({ fotoUrl: urlSaaSFoto, URL_SaaS: urlSaaSFoto, mensaje: 'FotografÃ­a actualizada' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/rh/personal/:id/documentos', async (req, res) => {
  const { id } = req.params
  try {
    let pool = await sql.connect(config)
    let r = await pool.request()
      .input('EID', sql.Int, parseInt(id, 10))
      .query(`
        SELECT 
          DocumentoID,
          EmpleadoID,
          TituloDocumento,
          TipoDocumento,
          FechaDocumento,
          FechaVencimiento,
          Notas,
          COALESCE(URL_SaaS, ArchivoURL) AS URL_SaaS,
          NombreArchivo,
          Activo,
          FechaSubida,
          FechaBajaERP
        FROM DocumentosEmpleadosRH 
        WHERE EmpleadoID = @EID 
        ORDER BY Activo DESC, FechaSubida DESC
      `)
    res.json(r.recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/rh/personal/:id/documentos', upload.single('archivo'), async (req, res) => {
  const { id } = req.params
  const { tituloDocumento, tipoDocumento, fechaDocumento, fechaVencimiento, notas } = req.body
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Debes adjuntar un archivo (PDF, imagen, documento)' })
    }
    const urlSaaS = await subirABlobYObtenerSAS(req.file, CONTAINER_DOCS_RH)

    let pool = await sql.connect(config)
    let r = await pool.request()
      .input('EID', sql.Int, parseInt(id, 10))
      .input('Titulo', sql.NVarChar, (tituloDocumento || req.file.originalname).trim())
      .input('Tipo', sql.NVarChar, tipoDocumento || 'General')
      .input('FDoc', sql.Date, fechaDocumento || new Date())
      .input('FVenc', sql.Date, fechaVencimiento || null)
      .input('Notas', sql.NVarChar, notas || null)
      .input('URL', urlSaaS)
      .input('NombreOrig', sql.NVarChar, req.file.originalname)
      .query(`
        INSERT INTO DocumentosEmpleadosRH
          (EmpleadoID, TituloDocumento, TipoDocumento, FechaDocumento, FechaVencimiento, Notas, URL_SaaS, ArchivoURL, NombreArchivo, Activo)
        VALUES
          (@EID, @Titulo, @Tipo, @FDoc, @FVenc, @Notas, @URL, @URL, @NombreOrig, 1);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS NuevoDocID;
      `)

    const nuevoDocId = r.recordset[0].NuevoDocID
    let docInsertado = await pool.request()
      .input('DID', sql.Int, nuevoDocId)
      .query(`
        SELECT 
          DocumentoID,
          EmpleadoID,
          TituloDocumento,
          TipoDocumento,
          FechaDocumento,
          FechaVencimiento,
          Notas,
          COALESCE(URL_SaaS, ArchivoURL) AS URL_SaaS,
          NombreArchivo,
          Activo,
          FechaSubida
        FROM DocumentosEmpleadosRH 
        WHERE DocumentoID = @DID
      `)

    res.json(docInsertado.recordset[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/rh/documentos/:docId/vigencia', async (req, res) => {
  const { docId } = req.params
  const { fechaVencimiento } = req.body
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('DID', sql.Int, parseInt(docId, 10))
      .input('FVenc', sql.Date, fechaVencimiento || null)
      .query('UPDATE DocumentosEmpleadosRH SET FechaVencimiento = @FVenc WHERE DocumentoID = @DID')
    res.json({ mensaje: 'Fecha de tÃ©rmino actualizada' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/rh/documentos/:docId', async (req, res) => {
  const { docId } = req.params
  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('DID', sql.Int, parseInt(docId, 10))
      .query(`
        UPDATE DocumentosEmpleadosRH 
        SET Activo = 0, 
            FechaBajaERP = GETDATE() 
        WHERE DocumentoID = @DID
      `)
    res.json({ mensaje: 'Documento archivado' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/rh/kpis', async (req, res) => {
  try {
    let pool = await sql.connect(config)
    let r = await pool.request().query(`
      SELECT k.*, p.NombreCompleto, p.Departamento, p.Puesto, p.Activo, COALESCE(p.URL_SaaS, p.FotoURL) AS FotoURL
      FROM EvaluacionesKPI k
      INNER JOIN PersonalRH p ON k.EmpleadoID = p.EmpleadoID
      ORDER BY k.PeriodoMes DESC, k.PromedioGlobal DESC
    `)
    res.json(r.recordset)
  } catch (e) { res.status(500).send(e.message) }
})

app.post('/api/rh/kpis', async (req, res) => {
  const {
    evaluacionID,
    empleadoID,
    periodoMes,
    frecuencia,
    areaEvaluada,
    kpiPuntualidad,
    kpiCalidad,
    kpiProductividad,
    kpiSeguridad5S,
    kpiColaboracion,
    metasCumplidas,
    metasAsignadas,
    comentarios
  } = req.body

  try {
    let pool = await sql.connect(config)
    let evalIdObjetivo = evaluacionID ? parseInt(evaluacionID, 10) : null

    if (!evalIdObjetivo) {
      let existe = await pool.request()
        .input('EID', sql.Int, parseInt(empleadoID, 10))
        .input('Mes', sql.VarChar, periodoMes)
        .query('SELECT EvaluacionID FROM EvaluacionesKPI WHERE EmpleadoID = @EID AND PeriodoMes = @Mes')

      if (existe.recordset.length > 0) {
        evalIdObjetivo = existe.recordset[0].EvaluacionID
      }
    }

    if (evalIdObjetivo) {
      await pool.request()
        .input('EvalID', sql.Int, evalIdObjetivo)
        .input('EID', sql.Int, parseInt(empleadoID, 10))
        .input('Mes', sql.VarChar, periodoMes)
        .input('Frec', sql.VarChar, frecuencia || 'MENSUAL')
        .input('Area', sql.NVarChar, areaEvaluada || null)
        .input('P1', sql.Decimal(5, 2), parseFloat(kpiPuntualidad) || 0)
        .input('P2', sql.Decimal(5, 2), parseFloat(kpiCalidad) || 0)
        .input('P3', sql.Decimal(5, 2), parseFloat(kpiProductividad) || 0)
        .input('P4', sql.Decimal(5, 2), parseFloat(kpiSeguridad5S) || 0)
        .input('P5', sql.Decimal(5, 2), parseFloat(kpiColaboracion) || 0)
        .input('MC', sql.Int, parseInt(metasCumplidas, 10) || 0)
        .input('MA', sql.Int, parseInt(metasAsignadas, 10) || 1)
        .input('Com', sql.NVarChar, comentarios || null)
        .query(`
          UPDATE EvaluacionesKPI
          SET EmpleadoID = @EID,
              PeriodoMes = @Mes,
              Frecuencia = @Frec,
              AreaEvaluada = COALESCE(@Area, AreaEvaluada),
              KpiPuntualidad = @P1,
              KpiCalidad = @P2,
              KpiProductividad = @P3,
              KpiSeguridad5S = @P4,
              KpiColaboracion = @P5,
              MetasCumplidas = @MC,
              MetasAsignadas = @MA,
              Comentarios = @Com,
              FechaEvaluacion = GETDATE()
          WHERE EvaluacionID = @EvalID
        `)
      return res.json({ mensaje: 'EvaluaciÃ³n KPI actualizada correctamente' })
    } else {
      await pool.request()
        .input('EID', sql.Int, parseInt(empleadoID, 10))
        .input('Mes', sql.VarChar, periodoMes)
        .input('Frec', sql.VarChar, frecuencia || 'MENSUAL')
        .input('Area', sql.NVarChar, areaEvaluada || null)
        .input('P1', sql.Decimal(5, 2), parseFloat(kpiPuntualidad) || 0)
        .input('P2', sql.Decimal(5, 2), parseFloat(kpiCalidad) || 0)
        .input('P3', sql.Decimal(5, 2), parseFloat(kpiProductividad) || 0)
        .input('P4', sql.Decimal(5, 2), parseFloat(kpiSeguridad5S) || 0)
        .input('P5', sql.Decimal(5, 2), parseFloat(kpiColaboracion) || 0)
        .input('MC', sql.Int, parseInt(metasCumplidas, 10) || 0)
        .input('MA', sql.Int, parseInt(metasAsignadas, 10) || 1)
        .input('Com', sql.NVarChar, comentarios || null)
        .query(`
          INSERT INTO EvaluacionesKPI
            (EmpleadoID, PeriodoMes, Frecuencia, AreaEvaluada, KpiPuntualidad, KpiCalidad, KpiProductividad, KpiSeguridad5S, KpiColaboracion, MetasCumplidas, MetasAsignadas, Comentarios)
          VALUES
            (@EID, @Mes, @Frec, @Area, @P1, @P2, @P3, @P4, @P5, @MC, @MA, @Com)
        `)
      return res.json({ mensaje: 'EvaluaciÃ³n KPI registrada correctamente' })
    }
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.put('/api/rh/kpis/:id', async (req, res) => {
  const { id } = req.params
  const {
    empleadoID,
    periodoMes,
    frecuencia,
    areaEvaluada,
    kpiPuntualidad,
    kpiCalidad,
    kpiProductividad,
    kpiSeguridad5S,
    kpiColaboracion,
    metasCumplidas,
    metasAsignadas,
    comentarios
  } = req.body

  try {
    let pool = await sql.connect(config)
    await pool.request()
      .input('EvalID', sql.Int, parseInt(id, 10))
      .input('EID', sql.Int, parseInt(empleadoID, 10))
      .input('Mes', sql.VarChar, periodoMes)
      .input('Frec', sql.VarChar, frecuencia || 'MENSUAL')
      .input('Area', sql.NVarChar, areaEvaluada || null)
      .input('P1', sql.Decimal(5, 2), parseFloat(kpiPuntualidad) || 0)
      .input('P2', sql.Decimal(5, 2), parseFloat(kpiCalidad) || 0)
      .input('P3', sql.Decimal(5, 2), parseFloat(kpiProductividad) || 0)
      .input('P4', sql.Decimal(5, 2), parseFloat(kpiSeguridad5S) || 0)
      .input('P5', sql.Decimal(5, 2), parseFloat(kpiColaboracion) || 0)
      .input('MC', sql.Int, parseInt(metasCumplidas, 10) || 0)
      .input('MA', sql.Int, parseInt(metasAsignadas, 10) || 1)
      .input('Com', sql.NVarChar, comentarios || null)
      .query(`
        UPDATE EvaluacionesKPI
        SET EmpleadoID = @EID,
            PeriodoMes = @Mes,
            Frecuencia = @Frec,
            AreaEvaluada = COALESCE(@Area, AreaEvaluada),
            KpiPuntualidad = @P1,
            KpiCalidad = @P2,
            KpiProductividad = @P3,
            KpiSeguridad5S = @P4,
            KpiColaboracion = @P5,
            MetasCumplidas = @MC,
            MetasAsignadas = @MA,
            Comentarios = @Com,
            FechaEvaluacion = GETDATE()
        WHERE EvaluacionID = @EvalID
      `)
    res.json({ mensaje: 'EvaluaciÃ³n KPI corregida correctamente' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => { console.log(`ðŸš€ Servidor en puerto ${PORT}`) })