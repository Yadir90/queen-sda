// Queen SDA — lector del IPV en Excel (plantilla PDL_LA_REINA_IPV_MEJORADO).
//
// Puerto fiel del lector del sistema original (client/src/xlsx.ts,
// función parseDayFile): lee el .xlsx 100 % en el propio dispositivo
// (ZIP + XML, sin librerías) y extrae el día con la misma estructura que
// el original entrega a su servidor: departamentos y productos, entradas,
// gastos del IPV, cuentas pagadas, foto de Almacén, ingresos de Entrada y
// mesas, billar de Juegos, fondos del Desglose con el detalle de cuentas
// por cobrar, y la foto de RH con las marcas por día. Las cifras se leen
// tal como vienen escritas en el archivo: este módulo nunca ajusta,
// redondea ni corrige un valor del IPV.
//
// Única desviación deliberada respecto al original, documentada en el
// punto exacto (búsqueda del CUADRE en el Desglose): el original busca
// la primera fila que MENCIONA «cuadre» y el título de sección
// «RESUMEN Y CUADRE DEL DÍA» le gana a la fila real «CUADRE
// (Ventas − Fondos)», así que un descuadre declarado en el IPV quedaba
// leído como 0. Aquí manda la fila exacta del cuadre — el mismo criterio
// que el propio lector original ya aplica con las transferencias — para
// que el descuadre del IPV se vea tal como el archivo lo declara.
//
// Módulo sin dependencias, compartido por la app (Vite) y por la prueba
// scripts/verify-ipv.mjs (Node). En el navegador DOMParser es nativo; en
// Node la prueba inyecta el de @xmldom/xmldom (solo devDependency).

const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    // Acepta: "1.000,50" (miles con punto, decimal con coma), "1 000,50",
    // "1000.50", "1,5", "$ 2 500". Nunca rompe: lo no numérico vale 0.
    let s = v.replace(/[$\s ]/g, '')
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    else if (s.includes(',')) s = s.replace(',', '.')
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}
function txt(v) {
  if (v == null) return ''
  return String(v).trim()
}

// ---------- ZIP ----------
async function unzip(buf) {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  // Find End Of Central Directory
  let eocd = -1
  const start = Math.max(0, bytes.length - 66000)
  for (let i = bytes.length - 22; i >= start; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('NOT_XLSX')
  const count = view.getUint16(eocd + 10, true)
  let off = view.getUint32(eocd + 16, true)
  const out = new Map()
  const decoder = new TextDecoder('utf-8')
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) break
    const method = view.getUint16(off + 10, true)
    const compSize = view.getUint32(off + 20, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLen = view.getUint16(off + 32, true)
    const localOff = view.getUint32(off + 42, true)
    const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen))
    off += 46 + nameLen + extraLen + commentLen
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue
    const lNameLen = view.getUint16(localOff + 26, true)
    const lExtraLen = view.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const comp = bytes.subarray(dataStart, dataStart + compSize)
    let text
    if (method === 0) {
      text = decoder.decode(comp)
    } else if (method === 8) {
      const stream = new Blob([comp]).stream().pipeThrough(
        new DecompressionStream('deflate-raw'),
      )
      text = await new Response(stream).text()
    } else {
      continue
    }
    out.set(name, text)
  }
  return out
}

function parseXml(xml) {
  return new DOMParser().parseFromString(xml, 'text/xml')
}
// getElementsByTagName como arreglo (en el navegador devuelve lista viva
// indexable; en el DOM de Node se accede con item(i): mismo resultado).
function els(root, tag) {
  const list = root.getElementsByTagName(tag)
  const out = []
  for (let i = 0; i < list.length; i++) out.push(list.item ? list.item(i) : list[i])
  return out
}
function colOf(ref) {
  const m = /^[A-Z]+/.exec(ref)
  if (!m) return 0
  let c = 0
  for (const ch of m[0]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return c // 1-indexed
}

// Celdas con fórmula y SIN ningún valor calculado guardado (<f> presente
// y elemento <v> ausente del todo): el navegador no tiene motor de
// cálculo, así que valen 0 y se avisa. Ojo: una fórmula cuyo resultado
// legítimo es vacío (los espacios en blanco de la plantilla para
// productos nuevos, la columna «Revisión», los IF que devuelven "")
// SÍ trae su <v>, aunque venga vacío — ese blanco es su valor correcto
// y no debe contar como «sin calcular».
const formulaWithoutValue = []

function sheetFromXml(xml, shared, sheetName = '') {
  const doc = parseXml(xml)
  const sheet = new Map() // row -> (col -> value)
  const rows = els(doc, 'row')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rNum = parseInt(row.getAttribute('r') ?? String(i + 1), 10)
    const cells = new Map()
    const cs = els(row, 'c')
    for (let j = 0; j < cs.length; j++) {
      const c = cs[j]
      const ref = c.getAttribute('r') ?? 'A1'
      const col = colOf(ref)
      const t = c.getAttribute('t')
      let value = ''
      if (t === 'inlineStr') {
        const ts = els(c, 't')
        let s = ''
        for (let k = 0; k < ts.length; k++) s += ts[k].textContent ?? ''
        value = s
      } else {
        const vEl = els(c, 'v')[0]
        const raw = vEl?.textContent ?? ''
        if (!vEl && els(c, 'f').length > 0) {
          formulaWithoutValue.push({ sheet: norm(sheetName), row: rNum, col })
        }
        if (t === 's') value = shared[parseInt(raw, 10)] ?? ''
        else if (t === 'str' || t === 'e') value = raw
        else {
          const n = parseFloat(raw)
          value = raw === '' ? '' : Number.isFinite(n) ? n : raw
        }
      }
      cells.set(col, value)
    }
    sheet.set(rNum, cells)
  }
  return sheet
}

const cell = (sheet, row, col) => {
  return sheet.get(row)?.get(col) ?? ''
}
function findRow(sheet, needle, col) {
  const target = norm(needle)
  for (const [r, cells] of sheet) {
    for (const [c, v] of cells) {
      if (col != null && c !== col) continue
      if (typeof v === 'string' && norm(v).includes(target)) return r
    }
  }
  return -1
}
// Primer número a la derecha de la celda-etiqueta dentro de una fila ya
// localizada (segunda mitad de labelValue en el lector original).
function rowLabelValue(sheet, r, needle) {
  const cells = sheet.get(r)
  if (!cells) return 0
  const sorted = [...cells.entries()].sort((a, b) => a[0] - b[0])
  const labelIdx = sorted.findIndex(
    ([, v]) => typeof v === 'string' && norm(v).includes(norm(needle)),
  )
  for (let i = labelIdx + 1; i < sorted.length; i++) {
    const v = sorted[i][1]
    if (typeof v === 'number') return v
  }
  return 0
}
function labelValue(sheet, needle, col) {
  const r = findRow(sheet, needle)
  if (r < 0) return 0
  const cells = sheet.get(r)
  if (col != null) return num(cells.get(col))
  return rowLabelValue(sheet, r, needle)
}

function excelDateToISO(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const s = txt(v)
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  }
  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s)
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  const parsed = new Date(s)
  if (!Number.isNaN(parsed.getTime())) {
    // Componentes locales (no toISOString): evita desfases de un día por UTC.
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
  }
  return ''
}

const IPV_SHEETS = [
  'Bebidas alcohólicas',
  'Bebidas no alcohólicas',
  'Elaboración',
  'Pizzas',
  'Cantina',
]

/**
 * Lee el Excel del IPV del día (cualquier objeto con arrayBuffer(), p. ej.
 * un File del navegador) y devuelve el payload del día, igual que el
 * lector original: { date, ventasDia, gananciaBruta, gananciaNeta,
 * mermasCosto, cuadre, departments, entries, gastosIpv, cuentasPagadas,
 * warehouse, ingresosEntradaMesas, juegos, fondos, rh, rhFechas,
 * totalRH, productCount, templateOrigin, warnings }.
 */
export async function parseDayFile(file) {
  const warnings = []
  formulaWithoutValue.length = 0
  const buf = await file.arrayBuffer()
  let files
  try {
    files = await unzip(buf)
  } catch {
    throw new Error('Este archivo no tiene el formato de la plantilla IPV mejorada')
  }
  const sharedXml = files.get('xl/sharedStrings.xml')
  const shared = []
  if (sharedXml) {
    const doc = parseXml(sharedXml)
    const sis = els(doc, 'si')
    for (let i = 0; i < sis.length; i++) {
      const ts = els(sis[i], 't')
      let s = ''
      for (let k = 0; k < ts.length; k++) s += ts[k].textContent ?? ''
      shared.push(s)
    }
  }
  const wbXml = files.get('xl/workbook.xml')
  const relsXml = files.get('xl/_rels/workbook.xml.rels')
  if (!wbXml || !relsXml) {
    throw new Error('Este archivo no tiene el formato de la plantilla IPV mejorada')
  }
  const rels = new Map()
  const relDoc = parseXml(relsXml)
  const relEls = els(relDoc, 'Relationship')
  for (let i = 0; i < relEls.length; i++) {
    const id = relEls[i].getAttribute('Id') ?? ''
    const target = relEls[i].getAttribute('Target') ?? ''
    rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)
  }
  const wbDoc = parseXml(wbXml)
  const sheetEls = els(wbDoc, 'sheet')
  const sheets = new Map() // normalized name -> sheet
  const sheetsRaw = new Map()
  for (let i = 0; i < sheetEls.length; i++) {
    const el = sheetEls[i]
    const name = el.getAttribute('name') ?? ''
    const rid = el.getAttribute('r:id') ?? el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
    const path = rels.get(rid)
    if (!path) continue
    const xml = files.get(path)
    if (!xml) continue
    const sh = sheetFromXml(xml, shared, name)
    sheets.set(norm(name), sh)
    sheetsRaw.set(name, sh)
  }
  const getSheet = (name) => sheets.get(norm(name))
  const metaSheet = getSheet('_SDA_META')
  const metaFingerprint = metaSheet ? txt(cell(metaSheet, 1, 2)) : ''
  const metaDate = metaSheet ? txt(cell(metaSheet, 2, 2)) : ''
  const templateOrigin = metaFingerprint.startsWith('SDA2-') && /^\d{4}-\d{2}-\d{2}$/.test(metaDate)
    ? { fingerprint: metaFingerprint, date: metaDate }
    : null
  // Hoja buscada por nombre flexible: el nombre exacto, o la primera cuyo
  // nombre normalizado contenga la clave (tolera renombres del usuario).
  const getSheetFlex = (name, hint) => {
    const exact = getSheet(name)
    if (exact) return exact
    for (const [n, sh] of sheets) if (n.includes(hint)) return sh
    return undefined
  }

  let paramSheet = getSheetFlex('Parámetros', 'parametr')
  if (!paramSheet) {
    // Último recurso: cualquier hoja que declare una fecha en B3.
    for (const [, sh] of sheets) {
      if (excelDateToISO(cell(sh, 3, 2))) { paramSheet = sh; break }
    }
    if (paramSheet) warnings.push('No encontré la hoja «Parámetros»; tomé la fecha de la primera hoja con fecha en B3.')
  }
  if (!paramSheet) {
    throw new Error('Este archivo no tiene el formato de la plantilla IPV mejorada: falta la hoja «Parámetros» con la fecha del día.')
  }
  // ---- Departments ----
  const departments = []
  const entries = []
  const gastosIpv = []
  let mermasCosto = 0
  let productCount = 0
  for (const depName of IPV_SHEETS) {
    // El departamento de coctelería puede llamarse «Cantina» o
    // «Coctelería» según la versión del IPV. Se importa siempre bajo el
    // nombre canónico «Cantina» para que sus productos entren en las
    // mismas categorías y filtros del catálogo alimentado por el último IPV.
    const sh = getSheetFlex(depName, norm(depName).split(' ')[0].slice(0, 6))
      ?? (depName === 'Cantina' ? getSheetFlex('Coctelería', 'coctel') : undefined)
    if (!sh) {
      warnings.push(`No encontré la hoja «${depName}»; ese departamento no se importó.`)
      continue
    }
    // Columnas de la tabla principal según el encabezado (filas 1–6);
    // si un encabezado no se reconoce, valen las columnas de la plantilla:
    // A No · B Código · C Descripción · D UM · F Entrada · K Precio de
    // venta · O Precio de costo.
    const col = { no: 1, codigo: 2, um: 4, saldoInicial: 5, entrada: 6, precioVenta: 11, precioCompra: 15, saldoFinal: 12, disponible: 7, baja: 8, traslado: 9, aLaVenta: 10, venta: 11 }
    for (let r = 1; r <= 8; r++) {
      const cells = sh.get(r)
      if (!cells) continue
      for (const [c, v] of cells) {
        if (typeof v !== 'string') continue
        const n = norm(v)
        if (n.includes('saldo inicial')) col.saldoInicial = c
        else if (n.includes('saldo final')) col.saldoFinal = c
        else if (n === 'disponible') col.disponible = c
        else if (n.includes('a la venta')) col.aLaVenta = c
        else if (n.includes('traslado')) col.traslado = c
        else if (n.includes('baja')) col.baja = c
        else if (n.includes('entrada')) col.entrada = c
        else if (n.includes('precio') && n.includes('venta')) col.precioVenta = c
        else if (n.includes('precio') && (n.includes('costo') || n.includes('compra'))) col.precioCompra = c
        else if (n.includes('codigo')) col.codigo = c
        else if (n === 'um' || n.includes('unidad')) col.um = c
        else if (n === 'venta') col.venta = c
      }
    }
    // find TOTAL row: C == TOTAL
    let totalRow = -1
    for (const [r, cells] of sh) {
      if (r < 7) continue
      const c3 = txt(cells.get(3))
      if (norm(c3) === 'total' || norm(c3).startsWith('total ')) { totalRow = r; break }
    }
    if (totalRow < 0) {
      warnings.push(`En «${depName}» no apareció la fila TOTAL; sumé los productos uno a uno.`)
    }
    const endRow = totalRow > 0 ? totalRow : Math.max(...sh.keys(), 7)
    // Bloque «ENTRADA DE PRODUCTOS (detalle del día)»: NO es la fuente (la
    // fuente es la columna Entrada de la tabla principal); solo completa
    // el precio de compra cuando el producto no lo trae.
    const blockPrice = new Map()
    let entradaRow = -1
    for (const [r, cells] of sh) {
      for (const [, v] of cells) {
        if (typeof v === 'string' && norm(v).includes('entrada de productos')) { entradaRow = r; break }
      }
      if (entradaRow > 0) break
    }
    if (entradaRow > 0) {
      for (let r = entradaRow + 2; r <= entradaRow + 60; r++) {
        const cells = sh.get(r)
        if (!cells) continue
        const descripcion = txt(cells.get(2))
        if (norm(descripcion).startsWith('total')) break
        if (!descripcion) continue
        const cantidad = num(cells.get(4))
        let precio = num(cells.get(5)) || num(cells.get(7))
        if (!precio && cantidad) precio = num(cells.get(6)) / cantidad
        if (precio > 0) blockPrice.set(norm(descripcion), precio)
      }
    }
    // La plantilla nueva llama «GASTOS» a este bloque. Se importa como
    // gasto operativo real, no como entrada de inventario. En bebidas, la
    // tabla de la hoja «Bebidas alcohólicas» consolida también las no
    // alcohólicas; la columna Destino/Observación conserva el departamento.
    let gastosRow = -1
    for (const [r, cells] of sh) {
      if ([...cells.values()].some((value) => typeof value === 'string' && norm(value).startsWith('gastos'))) {
        gastosRow = r
        break
      }
    }
    if (gastosRow > 0) {
      const header = sh.get(gastosRow + 1)
      const expenseCols = { concept: 2, um: 3, quantity: 4, unitValue: 5, total: 6, category: 7, note: 8 }
      if (header) for (const [c, value] of header) {
        const label = norm(txt(value))
        if (label.includes('descripcion')) expenseCols.concept = c
        else if (label === 'um' || label.includes('unidad')) expenseCols.um = c
        else if (label.includes('cantidad')) expenseCols.quantity = c
        else if (label.includes('precio de compra')) expenseCols.unitValue = c
        else if (label.includes('importe')) expenseCols.total = c
        else if (label.includes('precio c') || label.includes('categoria')) expenseCols.category = c
        else if (label.includes('destino') || label.includes('observacion')) expenseCols.note = c
      }
      const lastRow = Math.max(...sh.keys(), gastosRow + 1)
      for (let r = gastosRow + 2; r <= lastRow; r++) {
        const cells = sh.get(r)
        if (!cells) continue
        const concept = txt(cells.get(expenseCols.concept))
        if (norm(concept).startsWith('total')) break
        if (!concept) continue
        const quantity = num(cells.get(expenseCols.quantity)) || 1
        const storedTotal = num(cells.get(expenseCols.total))
        const unitValue = num(cells.get(expenseCols.unitValue)) || (quantity ? storedTotal / quantity : storedTotal)
        const total = storedTotal || quantity * unitValue
        if (total <= 0) continue
        const note = txt(cells.get(expenseCols.note))
        const noteKey = norm(note)
        const dept = depName === 'Bebidas alcohólicas' && noteKey.includes('bebidas no alcohol')
          ? 'Bebidas no alcohólicas'
          : depName
        gastosIpv.push({
          dept,
          concept,
          um: txt(cells.get(expenseCols.um)),
          quantity,
          unitValue,
          total,
          category: txt(cells.get(expenseCols.category)) || 'Otros',
          note,
        })
      }
    }
    const products = []
    let category = ''
    for (let r = 7; r < endRow; r++) {
      const cells = sh.get(r)
      if (!cells) continue
      const a = txt(cells.get(1))
      const name = txt(cells.get(3))
      if (!name) continue
      if (!a) { category = name; continue }
      const bajas = num(cells.get(col.baja))
      const traslados = num(cells.get(col.traslado))
      const precioCosto = num(cells.get(15))
      // Regla fijada del IPV: el Desglose y el Análisis general reflejan
      // solo Bebidas alcohólicas + Bebidas no alcohólicas + Elaboración.
      // Cantina y Pizzas viven en sus propias hojas (sus productos y su
      // existencia se importan igual), pero sus mermas no entran en la
      // ganancia neta del día, igual que su venta no entra en el Desglose.
      if (depName === 'Bebidas alcohólicas' || depName === 'Bebidas no alcohólicas' || depName === 'Elaboración') {
        mermasCosto += (bajas + traslados) * precioCosto
      }
      const cantidadVendida = num(cells.get(col.venta))
      // Existencia al cierre: si la celda «Saldo final» viene escrita es el
      // conteo físico; si viene vacía, la teórica (Disponible − salidas).
      const rawFinal = cells.get(col.saldoFinal)
      const hasFinal = rawFinal !== undefined && rawFinal !== ''
      const existenciaFinal = hasFinal
        ? num(rawFinal)
        : num(cells.get(col.disponible)) - bajas - traslados - cantidadVendida
      // Cadena del IPV tal como viene: saldo inicial / disponible / a la
      // venta solo se guardan si la celda viene escrita (null = no viene).
      const rawCell = (c) => {
        const v = cells.get(c)
        return v === undefined || v === '' ? null : num(v)
      }
      products.push({
        name,
        category,
        um: txt(cells.get(col.um)),
        cantidadVendida,
        importeVenta: num(cells.get(14)),
        ganancia: num(cells.get(17)),
        bajas,
        traslados,
        precioCosto,
        precioVenta: num(cells.get(13)),
        existenciaFinal,
        existenciaFuente: hasFinal ? 'fisica' : 'teorica',
        saldoInicial: rawCell(col.saldoInicial),
        disponible: rawCell(col.disponible),
        aLaVenta: rawCell(col.aLaVenta),
      })
      // Entrada del día: columna «Entrada» (F) de esta misma fila.
      const entradaCant = num(cells.get(col.entrada))
      if (entradaCant > 0) {
        let precioCompra = num(cells.get(col.precioCompra))
        if (!precioCompra) precioCompra = blockPrice.get(norm(name)) ?? 0
        const precioVentaE = num(cells.get(col.precioVenta))
        const importeCompra = entradaCant * precioCompra
        const importeVentaE = entradaCant * precioVentaE
        entries.push({
          dept: depName,
          no: txt(cells.get(col.no)),
          codigo: txt(cells.get(col.codigo)),
          descripcion: name,
          um: txt(cells.get(col.um)),
          cantidad: entradaCant,
          precioCompra,
          importe: importeCompra,
          precioVenta: precioVentaE,
          importeVenta: importeVentaE,
          ganancia: importeVentaE - importeCompra,
          precioC: precioCompra,
        })
      }
    }
    productCount += products.length
    const venta = totalRow > 0 ? num(cell(sh, totalRow, 14)) : products.reduce((s, p) => s + p.importeVenta, 0)
    const costo = totalRow > 0 ? num(cell(sh, totalRow, 16)) : 0
    const ganancia = totalRow > 0 ? num(cell(sh, totalRow, 17)) : products.reduce((s, p) => s + p.ganancia, 0)
    departments.push({ name: depName, venta, costo, ganancia, products })
  }
  if (departments.length === 0) {
    throw new Error('Este archivo no tiene el formato de la plantilla IPV mejorada')
  }

  const date = excelDateToISO(cell(paramSheet, 3, 2))
  if (!date) {
    throw new Error('No se pudo leer la fecha del día (hoja «Parámetros», celda B3). Revisa la plantilla.')
  }

  // ---- Cuentas pagadas: pagos que regresan del IPV al sistema ----
  // La hoja la crea SDA con Fecha / Cliente / Importe / Forma de pago.
  // Puede traer cinco filas listas para completar y una fila Total: solo
  // se leen filas completas, sin convertir espacios vacíos en pagos.
  const cuentasPagadas = []
  const paidSheet = getSheetFlex('Cuentas pagadas', 'cuentas pagad')
  if (paidSheet) {
    let headerRow = -1
    const paidCols = { date: 1, client: 2, amount: 3, method: 4 }
    for (let r = 1; r <= 12 && headerRow < 0; r++) {
      const cells = paidSheet.get(r)
      if (!cells) continue
      const labels = [...cells.values()].map((value) => norm(txt(value)))
      if (!labels.some((label) => label.includes('cliente')) || !labels.some((label) => label.includes('importe'))) continue
      headerRow = r
      for (const [col, value] of cells) {
        const label = norm(txt(value))
        if (label.includes('fecha')) paidCols.date = col
        else if (label.includes('cliente')) paidCols.client = col
        else if (label.includes('importe') || label.includes('monto')) paidCols.amount = col
        else if (label.includes('forma') || label.includes('metodo')) paidCols.method = col
      }
    }
    if (headerRow < 0) {
      warnings.push('La hoja «Cuentas pagadas» no conserva sus encabezados; no se procesaron pagos desde esa hoja.')
    } else {
      const seen = new Set()
      let incomplete = 0
      const lastRow = Math.max(headerRow, ...paidSheet.keys())
      for (let r = headerRow + 1; r <= lastRow; r++) {
        const client = txt(cell(paidSheet, r, paidCols.client))
        const amount = Math.round(num(cell(paidSheet, r, paidCols.amount)))
        const rawDate = cell(paidSheet, r, paidCols.date)
        const paidDate = excelDateToISO(rawDate)
        const methodText = norm(txt(cell(paidSheet, r, paidCols.method)))
        const rowLabel = norm(client)
        if (rowLabel === 'total' || rowLabel.startsWith('total ')) continue
        const hasAny = Boolean(client || txt(rawDate) || amount || methodText)
        if (!hasAny) continue
        if (!client || amount <= 0 || !paidDate) { incomplete++; continue }
        const paymentMethod = methodText.includes('transf') ? 'transferencia' : 'efectivo'
        const key = `${paidDate}::${norm(client)}::${amount}::${paymentMethod}`
        if (seen.has(key)) continue
        seen.add(key)
        cuentasPagadas.push({ paidDate, client, amount, paymentMethod })
      }
      if (incomplete > 0) warnings.push(`Se omitieron ${incomplete} fila${incomplete === 1 ? '' : 's'} incompleta${incomplete === 1 ? '' : 's'} de «Cuentas pagadas»; cada pago necesita fecha, cliente e importe.`)
    }
  }

  // ---- Almacén: foto exacta de la tabla original ----
  const warehouse = []
  const warehouseSheet = getSheetFlex('Almacén', 'almacen')
  if (!warehouseSheet) {
    warnings.push('No encontré la hoja «Almacén»; no se pudo comprobar el cuadre de existencias.')
  } else {
    let headerRow = -1
    let totalRow = -1
    for (const [r, cells] of warehouseSheet) {
      if (norm(txt(cells.get(2))).includes('descripcion') && norm(txt(cells.get(9))).includes('saldo final')) headerRow = r
      if (norm(txt(cells.get(2))) === 'total') { totalRow = r; break }
    }
    if (headerRow < 0 || totalRow < 0) {
      warnings.push('La hoja «Almacén» no conserva los encabezados y el total esperados; no se pudo comprobar su contenido.')
    } else {
      for (let r = headerRow + 1; r < totalRow; r++) {
        const product = txt(cell(warehouseSheet, r, 2))
        if (!product) continue
        const saldoInicial = num(cell(warehouseSheet, r, 4))
        const entrada = num(cell(warehouseSheet, r, 5))
        const baja = num(cell(warehouseSheet, r, 7))
        const salida = num(cell(warehouseSheet, r, 8))
        const storedFinal = cell(warehouseSheet, r, 9)
        const saldoFinal = storedFinal === '' ? saldoInicial + entrada - baja - salida : num(storedFinal)
        const precioCompra = num(cell(warehouseSheet, r, 10))
        const storedValue = num(cell(warehouseSheet, r, 11))
        warehouse.push({
          product,
          um: txt(cell(warehouseSheet, r, 3)),
          saldoInicial,
          entrada,
          baja,
          salida,
          saldoFinal,
          precioCompra,
          valor: storedValue || saldoFinal * precioCompra,
          observacion: txt(cell(warehouseSheet, r, 12)),
        })
      }
    }
  }

  // ---- Entrada y mesas: ingresos automáticos del día ----
  // Esta hoja no forma parte de las ventas de productos. Sus filas
  // «Entrada» y «Mesas» se registran como otros ingresos independientes,
  // con la fecha del IPV. El importe guardado en la hoja manda; si la
  // fórmula no trae valor calculado, se deriva Cantidad × Precio.
  const ingresosEntradaMesas = []
  const emSheet = getSheetFlex('Entrada y mesas', 'entrada y mesa')
  if (!emSheet) {
    warnings.push('No encontré la hoja «Entrada y mesas»; ese día quedó sin cobros automáticos de entrada ni alquiler de mesas.')
  } else {
    let headerRow = -1
    let descCol = 3
    let quantityCol = 4
    let priceCol = 5
    let amountCol = 6
    for (let r = 1; r <= 12 && headerRow < 0; r++) {
      const cells = emSheet.get(r)
      if (!cells) continue
      const labels = [...cells.entries()].filter(([, v]) => typeof v === 'string')
      const hasDescription = labels.some(([, v]) => norm(v).includes('descripcion'))
      const hasAmount = labels.some(([, v]) => norm(v).includes('importe'))
      if (!hasDescription || !hasAmount) continue
      headerRow = r
      for (const [c, v] of labels) {
        const n = norm(v)
        if (n.includes('descripcion')) descCol = c
        else if (n.includes('cantidad')) quantityCol = c
        else if (n.includes('precio')) priceCol = c
        else if (n.includes('importe')) amountCol = c
      }
    }
    if (headerRow < 0) {
      warnings.push('La hoja «Entrada y mesas» no trae los encabezados de Descripción e Importe; no se registraron esos cobros.')
    } else {
      const totals = new Map()
      const maxRow = Math.max(...emSheet.keys(), headerRow)
      for (let r = headerRow + 1; r <= maxRow; r++) {
        const description = txt(cell(emSheet, r, descCol))
        const key = norm(description)
        if (!key) continue
        if (key.includes('total')) break
        const concepto = key.includes('entrada') ? 'Cobro de entrada' : key.includes('mesa') ? 'Alquiler de mesas' : null
        if (!concepto) continue
        const quantity = num(cell(emSheet, r, quantityCol))
        const price = num(cell(emSheet, r, priceCol))
        const storedAmount = num(cell(emSheet, r, amountCol))
        const importe = storedAmount || quantity * price
        if (importe > 0) totals.set(concepto, (totals.get(concepto) ?? 0) + importe)
      }
      for (const concepto of ['Cobro de entrada', 'Alquiler de mesas']) {
        const importe = totals.get(concepto) ?? 0
        if (importe > 0) ingresosEntradaMesas.push({ concepto, importe })
      }
    }
  }

  // ---- Juegos / billar: SOLO la fila del día en la tabla de billar ----
  // La hoja «Juegos» es un registro por período (una fila por día + fila
  // TOTAL del período). La fila TOTAL es el ACUMULADO y jamás es el día:
  // el billar de un IPV es únicamente su fila (Fecha = día del IPV), con
  // horas de día × precio de día + horas de noche × precio de noche.
  // Dos variantes reales de la plantilla, detectadas por el encabezado:
  //  A) C Horas día · D Precio día · E Importe día · F Horas noche ·
  //     G Precio noche · H Importe noche · I Venta total · J Total horas ·
  //     K/L Pago encargado día/noche · M Total a pagar.
  //  B) C Total horas · D Horas día · E Precio día · F Importe día ·
  //     G Horas noche · H Precio noche · I Importe noche · J Total ·
  //     M/P Pago día/noche · Q Total general.
  let juegos = null
  const jSheet = getSheetFlex('Juegos', 'juego')
  if (!jSheet) warnings.push('No encontré la hoja «Juegos»; el billar de ese día no quedó guardado.')
  if (jSheet) {
    const dayNum = Number(date.slice(8, 10))
    // Precios y pagos de «Parámetros» (respaldo si una celda de precio/pago
    // viene como fórmula sin valor calculado): B7/B8 precios, B9/B10 pagos.
    const paramRate = (needleA, needleB) => {
      if (!paramSheet) return 0
      for (const [, cells] of paramSheet) {
        for (const [c, v] of cells) {
          if (typeof v !== 'string') continue
          const n = norm(v)
          if (!n.includes(needleA) || (needleB && !n.includes(needleB))) continue
          for (let cc = c + 1; cc <= c + 5; cc++) {
            const val = num(cells.get(cc))
            if (val > 0) return val
          }
        }
      }
      return 0
    }
    const paramPrecioDia = paramRate('precio', 'dia')
    const paramPrecioNoche = paramRate('precio', 'noche')
    const paramPagoDia = paramRate('pago', 'dia')
    const paramPagoNoche = paramRate('pago', 'noche')
    // Fila de encabezado: la que menciona «horas» (normalmente la 6).
    let headerRow = -1
    for (const [r, cells] of jSheet) {
      if (r > 12) break
      for (const [, v] of cells) {
        if (typeof v === 'string' && norm(v).includes('horas')) { headerRow = r; break }
      }
      if (headerRow > 0) break
    }
    if (headerRow < 0) headerRow = 6
    const hCells = jSheet.get(headerRow)
    const hText = new Map()
    if (hCells) for (const [c, v] of hCells) if (typeof v === 'string') hText.set(c, norm(v))
    const findCol = (...preds) => {
      for (const pred of preds) {
        for (const [c, t] of hText) if (pred(t)) return c
      }
      return 0
    }
    let horasDiaCol = 0, precioDiaCol = 0, importeDiaCol = 0
    let horasNocheCol = 0, precioNocheCol = 0, importeNocheCol = 0
    let ventaCol = 0, totalHorasCol = 0, pagoTotalCol = 0
    let pagoDiaTotalCol = 0, pagoNocheTotalCol = 0
    let variantB = false
    const aHorasDia = findCol((t) => t.includes('horas') && t.includes('dia'))
    const aPrecioDia = findCol((t) => t.includes('precio') && t.includes('dia'))
    if (aHorasDia > 0 && aPrecioDia > 0) {
      // Variante A (encabezados completos «Horas día / Precio día (CUP)»).
      horasDiaCol = aHorasDia
      precioDiaCol = aPrecioDia
      importeDiaCol = findCol((t) => t.includes('importe') && t.includes('dia'))
      horasNocheCol = findCol((t) => t.includes('horas') && t.includes('noche'))
      precioNocheCol = findCol((t) => t.includes('precio') && t.includes('noche'))
      importeNocheCol = findCol((t) => t.includes('importe') && t.includes('noche'))
      ventaCol = findCol((t) => t.includes('venta'))
      totalHorasCol = findCol((t) => t.includes('total') && t.includes('horas'))
      pagoDiaTotalCol = findCol((t) => t.includes('pago') && t.includes('dia'))
      pagoNocheTotalCol = findCol((t) => t.includes('pago') && t.includes('noche'))
      pagoTotalCol = findCol(
        (t) => t.includes('total a pagar'),
        (t) => t.includes('a pagar'),
      )
    } else if (findCol((t) => t.includes('total') && t.includes('horas')) > 0) {
      // Variante B (encabezados cortos; columnas según sus fórmulas).
      variantB = true
      totalHorasCol = 3
      horasDiaCol = 4; precioDiaCol = 5; importeDiaCol = 6
      horasNocheCol = 7; precioNocheCol = 8; importeNocheCol = 9
      ventaCol = 10
      pagoDiaTotalCol = 13; pagoNocheTotalCol = 16; pagoTotalCol = 17
    }
    if (!horasDiaCol) {
      // Último recurso: variante A por posición (plantilla con Parámetros).
      horasDiaCol = 3; precioDiaCol = 4; importeDiaCol = 5
      horasNocheCol = 6; precioNocheCol = 7; importeNocheCol = 8
      ventaCol = 9; totalHorasCol = 10
      pagoDiaTotalCol = 11; pagoNocheTotalCol = 12; pagoTotalCol = 13
    }
    // Fila de ESTE día: A = día del IPV y B = día de la semana. La fila
    // TOTAL (B = «TOTAL») nunca es candidata aunque comparta columnas.
    let dayCells = null
    for (let r = headerRow + 1; r <= headerRow + 45; r++) {
      const cells = jSheet.get(r)
      if (!cells) continue
      if (norm(txt(cells.get(2))) === 'total') break
      if (num(cells.get(1)) !== dayNum) continue
      if (!txt(cells.get(2))) continue
      dayCells = cells
      break
    }
    if (!dayCells) {
      warnings.push(`No encontré la fila del día ${dayNum} en la tabla de billar de la hoja «Juegos»; el billar de ese día no quedó guardado (reimporta el IPV para verlo).`)
    } else {
      const horasDia = num(dayCells.get(horasDiaCol))
      const horasNoche = num(dayCells.get(horasNocheCol))
      const precioDia = num(dayCells.get(precioDiaCol)) || paramPrecioDia
      const precioNoche = num(dayCells.get(precioNocheCol)) || paramPrecioNoche
      // Importes: el valor guardado manda; si la celda es fórmula sin
      // valor calculado, se deriva horas × precio de la propia fila.
      let importeDia = importeDiaCol ? num(dayCells.get(importeDiaCol)) : 0
      if (!importeDia && horasDia) importeDia = horasDia * precioDia
      let importeNoche = importeNocheCol ? num(dayCells.get(importeNocheCol)) : 0
      if (!importeNoche && horasNoche) importeNoche = horasNoche * precioNoche
      let venta = ventaCol ? num(dayCells.get(ventaCol)) : 0
      if (!venta) venta = importeDia + importeNoche
      let horas = totalHorasCol ? num(dayCells.get(totalHorasCol)) : 0
      if (!horas) horas = horasDia + horasNoche
      let pago = pagoTotalCol ? num(dayCells.get(pagoTotalCol)) : 0
      if (!pago && pagoDiaTotalCol && pagoNocheTotalCol) {
        pago = num(dayCells.get(pagoDiaTotalCol)) + num(dayCells.get(pagoNocheTotalCol))
      }
      if (!pago && (horasDia || horasNoche)) {
        if (variantB) pago = horasDia * num(dayCells.get(12)) + horasNoche * num(dayCells.get(15))
        if (!pago && (paramPagoDia || paramPagoNoche)) pago = horasDia * paramPagoDia + horasNoche * paramPagoNoche
      }
      juegos = {
        venta,
        pagoEncargado: pago,
        horas,
        utilidad: venta - pago,
        horasDia,
        precioDia,
        importeDia,
        horasNoche,
        precioNoche,
        importeNoche,
        tablaGuardada: true,
      }
    }
  }

  // ---- Desglose / fondos ----
  let fondos = null
  let cuadre = 0
  let ventasDesglose = 0
  const dSheet = getSheetFlex('Desglose', 'desglose')
  if (!dSheet) warnings.push('No encontré la hoja «Desglose»; sin fondos ni cuadre, y las cuentas por cobrar de este día no se registraron.')
  if (dSheet) {
    const efectivo = labelValue(dSheet, 'Total efectivo CUP', 3)
    const divisasCUP = labelValue(dSheet, 'Total divisas', 4)
    const totalCuentas = labelValue(dSheet, 'Total cuentas por cobrar', 2)
    const zelle = labelValue(dSheet, 'Total Zelle', 2)
    // Transferencias: la etiqueta vive en la columna A y el importe en la
    // columna B de esa misma fila («Transferencias recibidas (CUP)» = 550
    // en el IPV del 6 de octubre). Se busca por la etiqueta en la columna
    // A, nunca por fila fija ni por la primera mención de la palabra: la
    // fila del encabezado de sección («5 · TRANSFERENCIAS») no trae
    // importe y ganaba la búsqueda antigua, dejando el día en 0. Si hay
    // varias candidatas manda la etiqueta exacta «Transferencias
    // recibidas»; si no, la primera fila de la columna A que mencione
    // transferencias.
    let transferencias = 0
    let transferRow = -1
    for (const [r, cells] of dSheet) {
      const etiqueta = norm(txt(cells.get(1)))
      if (!etiqueta.includes('transferencias')) continue
      if (etiqueta.includes('transferencias recibidas')) { transferRow = r; break }
      if (transferRow < 0) transferRow = r
    }
    if (transferRow > 0) {
      transferencias = num(cell(dSheet, transferRow, 2))
    } else {
      warnings.push('No encontré la fila «Transferencias recibidas» en la columna A de la hoja «Desglose»; las transferencias del día quedaron en 0.')
    }
    ventasDesglose =
      labelValue(dSheet, 'Ventas del día') || labelValue(dSheet, 'ventas del dia')
    const totalFondos = labelValue(dSheet, 'Total de fondos') || labelValue(dSheet, 'total fondos')
    // CUADRE — DESVIACIÓN DELIBERADA respecto al lector original,
    // documentada en la cabecera de este módulo: la fila exacta
    // «CUADRE (Ventas − Fondos)» manda sobre el título de sección
    // «RESUMEN Y CUADRE DEL DÍA». Es el mismo criterio que el lector
    // original ya aplica arriba con las transferencias (la etiqueta
    // exacta gana al encabezado de sección). Sin esto, el título gana
    // la búsqueda por mención y un descuadre declarado en el IPV se
    // leería como 0: el descuadre del archivo debe verse, no esconderse.
    {
      let cuadreRow = -1
      for (const [r, cells] of dSheet) {
        for (const [, v] of cells) {
          if (typeof v === 'string' && norm(v).startsWith('cuadre')) { cuadreRow = r; break }
        }
        if (cuadreRow > 0) break
      }
      cuadre = cuadreRow > 0
        ? rowLabelValue(dSheet, cuadreRow, 'cuadre')
        : labelValue(dSheet, 'CUADRE')
    }
    // detalle cuentas por cobrar: filas sobre el total. Saldos como texto
    // ("1.000") también cuentan; una fila rara se salta, no corta la
    // lista. También se lee la columna «Observaciones» de esa misma
    // sección: cuando dice «ok», esa cuenta ya se pagó y el servidor la
    // registra PAGADA al importar, con la fecha de este día. La columna
    // se busca por su encabezado junto al título de la sección; si la
    // hoja no trae encabezado, se usa la columna C (la siguiente al saldo).
    const detalle = []
    const totalRowC = findRow(dSheet, 'Total cuentas por cobrar')
    if (totalRowC > 1) {
      let obsCol = 3
      let titleRowC = -1
      for (let r = totalRowC - 1; r >= Math.max(1, totalRowC - 30); r--) {
        if (norm(txt(cell(dSheet, r, 1))).includes('cuentas por cobrar')) { titleRowC = r; break }
      }
      if (titleRowC > 0) {
        for (let r = titleRowC; r <= Math.min(titleRowC + 1, totalRowC - 1) && obsCol === 3; r++) {
          const cells = dSheet.get(r)
          if (!cells) continue
          for (const [c, v] of cells) {
            if (typeof v === 'string' && norm(v).includes('observ')) { obsCol = c; break }
          }
        }
      }
      // «ok» como palabra completa en Observaciones = cuenta ya pagada.
      const esOk = (s) => norm(s).replace(/[^a-z0-9 ]/g, '').trim() === 'ok'
      for (let r = totalRowC - 1; r >= Math.max(1, totalRowC - 30); r--) {
        const nombre = txt(cell(dSheet, r, 1))
        if (norm(nombre).includes('cuentas por cobrar')) break
        if (!nombre) continue
        const saldo = num(cell(dSheet, r, 2))
        const observacion = txt(cell(dSheet, r, obsCol))
        // Saldo 0 sin «ok» no es una cuenta; con «ok» la fila sí viaja
        // (importe 0) para que el servidor cierre como pagada la cuenta
        // que ya existía como pendiente.
        if (saldo === 0 && !esOk(observacion)) continue
        detalle.unshift({ nombre, saldo, observacion })
      }
    }
    // ---- Arqueo por billetes (CUP) y Divisas (USD/EUR) del Desglose ----
    const billetes = []
    let efectivoContado = 0
    const cashHeader = findRow(dSheet, 'Billetes')
    if (cashHeader > 0) {
      const hCells = dSheet.get(cashHeader)
      let countCol = 2
      let totalCol = 3
      for (const [c, v] of hCells) {
        if (typeof v !== 'string') continue
        const n = norm(v)
        if (n.includes('billete') || n.includes('cantidad')) countCol = c
        else if (n.includes('total') || n.includes('subtotal')) totalCol = c
      }
      const denomCol = Math.max(1, countCol - 1)
      for (let r = cashHeader + 1; r <= cashHeader + 30; r++) {
        const cells = dSheet.get(r)
        if (!cells) continue
        if (norm(txt(cells.get(denomCol))).startsWith('total')) {
          efectivoContado = num(cells.get(totalCol))
          break
        }
        const denominacion = num(cells.get(denomCol))
        if (denominacion <= 0) continue
        const cantidad = num(cells.get(countCol))
        const subtotal = num(cells.get(totalCol)) || denominacion * cantidad
        billetes.push({ denominacion, cantidad, subtotal })
      }
      if (!efectivoContado) efectivoContado = billetes.reduce((s, b) => s + b.subtotal, 0)
    } else {
      warnings.push('No encontré el desglose por billetes en la hoja «Desglose»; ese detalle no quedó guardado.')
    }
    // Tasas de «Parámetros» (USD/EUR) si la hoja las trae.
    const paramRates = new Map()
    if (paramSheet) {
      for (const [, cells] of paramSheet) {
        for (const [c, v] of cells) {
          if (typeof v !== 'string') continue
          const n = norm(v)
          const moneda = n.includes('usd') ? 'USD' : n.includes('eur') ? 'EUR' : ''
          if (!moneda || paramRates.has(moneda)) continue
          for (let cc = c + 1; cc <= c + 5; cc++) {
            const rate = num(cells.get(cc))
            if (rate > 0) { paramRates.set(moneda, rate); break }
          }
        }
      }
    }
    const mlc = []
    let mlcTotalCup = 0
    // La sección real del Desglose es «2 · DIVISAS (conversión a CUP)»:
    // filas USD/EUR con Moneda · Tasa (CUP) · Cantidad · Equivalente (CUP).
    // Las plantillas viejas traían el mismo detalle bajo el título «MLC»
    // (Precio · Cantidad · Convención, con la moneda al final, incluso
    // «EURO»). Se busca «DIVISAS» primero y «MLC» solo como respaldo.
    let mlcTitle = -1
    for (const [r, cells] of dSheet) {
      for (const [, v] of cells) {
        if (typeof v !== 'string') continue
        const n = norm(v)
        if (n.includes('divisas') && !n.startsWith('total')) { mlcTitle = r; break }
      }
      if (mlcTitle > 0) break
    }
    if (mlcTitle < 0) mlcTitle = findRow(dSheet, 'MLC')
    if (mlcTitle > 0) {
      let header = -1
      for (let r = mlcTitle + 1; r <= mlcTitle + 4; r++) {
        const cells = dSheet.get(r)
        if (!cells) continue
        for (const [, v] of cells) {
          if (typeof v === 'string' && (norm(v).includes('precio') || norm(v).includes('tasa') || norm(v).includes('cantidad') || norm(v).includes('equivalente'))) { header = r; break }
        }
        if (header > 0) break
      }
      if (header > 0) {
        const hCells = dSheet.get(header)
        let rateCol = 1
        let qtyCol = 2
        let convCol = 3
        let denomCol = 0
        let monedaCol = 0
        for (const [c, v] of hCells) {
          if (typeof v !== 'string') continue
          const n = norm(v)
          if (n.includes('denomin')) denomCol = c
          else if (n.includes('moneda')) monedaCol = c
          else if (n.includes('precio') || n.includes('tasa')) rateCol = c
          else if (n.includes('cantidad') || n.includes('billete')) qtyCol = c
          else if (n.includes('convenc') || n.includes('convers') || n.includes('equivalente') || n.includes('total')) convCol = c
        }
        const currencyCol = monedaCol > 0 ? monedaCol : convCol + 1
        for (let r = header + 1; r <= header + 16; r++) {
          const cells = dSheet.get(r)
          if (!cells) continue
          if (norm(txt(cells.get(currencyCol))).startsWith('total') || norm(txt(cells.get(1))).startsWith('total')) break
          let moneda = txt(cells.get(currencyCol)).toUpperCase()
          if (moneda === 'EURO') moneda = 'EUR'
          if (moneda !== 'USD' && moneda !== 'EUR') {
            for (const [, v] of cells) {
              const t = txt(v).toUpperCase()
              if (t === 'USD' || t === 'EUR' || t === 'EURO') { moneda = t === 'EURO' ? 'EUR' : t; break }
            }
          }
          if (moneda !== 'USD' && moneda !== 'EUR') continue
          const denominacion = denomCol > 0 ? num(cells.get(denomCol)) : 0
          const cantidad = num(cells.get(qtyCol))
          const tasa = paramRates.get(moneda) || num(cells.get(rateCol))
          let conversionCup = num(cells.get(convCol))
          if (!conversionCup) {
            conversionCup = cantidad * (denominacion > 0 ? denominacion : 1) * tasa
          }
          if (cantidad === 0 && conversionCup === 0) continue
          mlc.push({ moneda, denominacion, cantidad, tasa, conversionCup })
          mlcTotalCup += conversionCup
        }
      }
    } else {
      warnings.push('No encontré la sección «Divisas» (USD/EUR) en la hoja «Desglose»; las divisas de ese día no quedaron guardadas.')
    }
    fondos = {
      efectivo: efectivoContado || efectivo,
      divisasCUP: mlcTotalCup || divisasCUP,
      totalCuentasPorCobrar: totalCuentas,
      cuentasDetalle: detalle,
      zelle,
      transferencias,
      totalFondos,
      ventas: ventasDesglose,
      billetes,
      mlc,
      arqueoGuardado: cashHeader > 0,
      mlcGuardado: mlcTitle > 0,
    }
  }

  // ---- RH: foto de personal + datos para el registro de trabajadores ----
  // Las columnas se ubican por el ENCABEZADO real de la hoja (la
  // plantilla ha tenido dos órdenes: Nombre/Carné/Cuenta/Móvil… y
  // Carné/Cuenta/Móvil/Nombre…), nunca por una posición supuesta.
  // Si los encabezados no se reconocen, se cae a las posiciones de
  // la plantilla vigente (B nombre, C ocupación, V días, W total,
  // X salario diario) para no perder ninguna importación.
  const rh = []
  let rhFechas = []
  const rhSheet = getSheetFlex('RH', 'rh')
  if (!rhSheet) warnings.push('No encontré la hoja «RH»; el día quedó sin foto de personal ni nómina.')
  if (rhSheet) {
    // Cadena de una celda para la ficha: «-» o vacío = sin dato. Los
    // números largos (carné/móvil escritos como número) se pasan a
    // texto sin notación científica.
    const cellText = (row, col) => {
      const v = cell(rhSheet, row, col)
      if (typeof v === 'number') {
        if (!Number.isFinite(v) || v === 0) return ''
        return String(Math.round(v))
      }
      const s = txt(v)
      return s === '-' ? '' : s
    }
    // Encabezado: primera fila (entre la 1 y la 10) con una celda
    // «nombre…». De ahí sale el mapa de columnas.
    let headerRow = -1
    const colByLabel = new Map()
    for (let r = 1; r <= 10 && headerRow < 0; r++) {
      const cells = rhSheet.get(r)
      if (!cells) continue
      for (const [, v] of cells) {
        if (typeof v === 'string' && norm(v).includes('nombre')) { headerRow = r; break }
      }
      if (headerRow < 0) continue
      for (const [c, v] of cells) {
        if (typeof v !== 'string') continue
        const h = norm(v)
        if (h.includes('nombre')) colByLabel.set('nombre', c)
        else if (h.includes('ocupacion') || h.includes('cargo')) colByLabel.set('ocupacion', c)
        else if (h.includes('carnet') || h.includes('carne') || h.includes('identidad')) colByLabel.set('carnet', c)
        else if (h.includes('cuenta')) colByLabel.set('cuenta', c)
        else if (h.includes('movil') || h.includes('telefono') || h.includes('celular')) colByLabel.set('movil', c)
        else if (h.includes('dias trabajados') || h === 'dias') colByLabel.set('dias', c)
        else if (h.includes('total a cobrar') || h.includes('a cobrar')) colByLabel.set('total', c)
        else if (h.includes('salario diario') || h.includes('valor del dia') || h.includes('valor dia')) colByLabel.set('salarioDiario', c)
      }
    }
    const hasHeaders = headerRow > 0 && colByLabel.has('nombre')
    const cNombre = hasHeaders ? colByLabel.get('nombre') : 2
    const cOcup = hasHeaders ? (colByLabel.get('ocupacion') ?? 0) : 3
    const cCarnet = hasHeaders ? (colByLabel.get('carnet') ?? 0) : 0
    const cCuenta = hasHeaders ? (colByLabel.get('cuenta') ?? 0) : 0
    const cMovil = hasHeaders ? (colByLabel.get('movil') ?? 0) : 0
    const cDias = hasHeaders ? (colByLabel.get('dias') ?? 0) : 22
    const cTotal = hasHeaders ? (colByLabel.get('total') ?? 0) : 23
    const cSalario = hasHeaders ? (colByLabel.get('salarioDiario') ?? 0) : 24
    // Columnas de días: entre la última columna personal y «Días
    // trabajados», la fila de encabezado trae el número de día del mes
    // (23, 24, …, 7). Sus fechas se deducen anclando la secuencia de
    // 15 días consecutivos con la fecha de ESTE IPV: solo hay una
    // posición en la que los números de día coinciden con `date`.
    const dayCols = []
    if (hasHeaders && cDias > 0) {
      const personalMax = Math.max(cNombre ?? 0, cOcup ?? 0, cCarnet ?? 0, cCuenta ?? 0, cMovil ?? 0)
      for (let c = personalMax + 1; c < cDias; c++) {
        const hv = num(cell(rhSheet, headerRow, c))
        if (hv >= 1 && hv <= 31) dayCols.push(c)
      }
    }
    if (dayCols.length >= 3 && date) {
      const numsDia = dayCols.map((c) => Math.round(num(cell(rhSheet, headerRow, c))))
      const [yy = 1970, mm = 1, dd = 1] = date.split('-').map(Number)
      for (let back = 0; back < dayCols.length && rhFechas.length === 0; back++) {
        const startMs = Date.UTC(yy, mm - 1, dd) - back * 86_400_000
        const fechas = []
        let ok = true
        for (let i = 0; i < dayCols.length; i++) {
          const d = new Date(startMs + i * 86_400_000)
          if (d.getUTCDate() !== numsDia[i]) { ok = false; break }
          fechas.push(d.toISOString().slice(0, 10))
        }
        if (ok) rhFechas = fechas
      }
      if (rhFechas.length === 0) dayCols.length = 0
    }
    // Con encabezados, los datos empiezan tras la fila de encabezado
    // (la fila de iniciales de días de la semana, si viene, trae el
    // nombre vacío y se salta sola). Sin encabezados, fila 8.
    const firstDataRow = hasHeaders ? headerRow + 1 : 8
    let endRow = Math.max(...rhSheet.keys(), firstDataRow)
    for (const [r, cells] of rhSheet) {
      if (r <= firstDataRow) continue
      if (norm(txt(cells.get(cNombre))).includes('total a pagar') || norm(txt(cells.get(1))).includes('total a pagar')) { endRow = r; break }
    }
    for (let r = firstDataRow; r < endRow; r++) {
      const nombre = cellText(r, cNombre)
      if (!nombre || norm(nombre) === 'total' || norm(nombre).includes('total a pagar')) continue
      rh.push({
        nombre,
        ocupacion: cOcup ? cellText(r, cOcup) : '',
        dias: cDias ? num(cell(rhSheet, r, cDias)) : 0,
        totalCobrar: cTotal ? num(cell(rhSheet, r, cTotal)) : 0,
        salarioDiario: cSalario ? num(cell(rhSheet, r, cSalario)) : 0,
        carnet: cCarnet ? cellText(r, cCarnet) : '',
        cuentaBancaria: cCuenta ? cellText(r, cCuenta) : '',
        movil: cMovil ? cellText(r, cMovil) : '',
        marcas: dayCols.length
          ? dayCols.map((c) => {
              const v = num(cell(rhSheet, r, c))
              return v > 0 ? Math.min(v, 1) : 0
            })
          : [],
      })
    }
  }

  // Misma regla: la ganancia bruta del día (base del Análisis) suma solo
  // los tres departamentos del Desglose; Cantina y Pizzas quedan en su
  // detalle por hoja y en existencias, fuera de este total. En los días
  // reales de octubre de 2026 ambos están en 0, así que ninguna cifra
  // guardada cambia por esta corrección: solo ordena importaciones futuras.
  const BASE_ANALISIS = ['Bebidas alcohólicas', 'Bebidas no alcohólicas', 'Elaboración']
  const gananciaBruta = departments.filter((d) => BASE_ANALISIS.includes(d.name)).reduce((s, d) => s + d.ganancia, 0)
  const ventasDia = ventasDesglose || departments.filter((d) => BASE_ANALISIS.includes(d.name)).reduce((s, d) => s + d.venta, 0)

  // Aviso de fórmulas sin valor calculado: solo cuentan las que el
  // importador realmente lee y en filas con datos. Los espacios en
  // blanco de las hojas de productos (filas sin Descripción, listas
  // para un producto nuevo) traen las fórmulas puestas a propósito y
  // su resultado es vacío: no son un error y no se avisan. Tampoco
  // cuentan las hojas que el importador no lee (Resumen, Análisis…).
  {
    const deptHints = ['bebidas alcoholicas', 'bebidas no alcoholicas', 'elaboracion', 'pizzas', 'cantina']
    let sinCalcular = 0
    for (const f of formulaWithoutValue) {
      const isDept = deptHints.some((h) => f.sheet.includes(h))
      const consumed = isDept || f.sheet === 'rh' || f.sheet.includes('parametr') || f.sheet.includes('juego') || f.sheet.includes('desglose') || f.sheet.includes('entrada y mesa')
      if (!consumed) continue
      if (isDept) {
        const sh = sheets.get(f.sheet)
        if (sh) {
          const desc = txt(cell(sh, f.row, 3))
          const no = txt(cell(sh, f.row, 1))
          const isTotal = norm(desc).startsWith('total')
          // Fila sin Descripción (o categoría sin número): el parser no
          // lee sus números; es un espacio en blanco de la plantilla.
          if (!isTotal && (!desc || !no)) continue
        }
      }
      sinCalcular++
    }
    if (sinCalcular > 0) {
      warnings.push(`Hay ${sinCalcular} celda${sinCalcular === 1 ? '' : 's'} con fórmula y sin valor calculado en el archivo; esas celdas se leyeron como 0. Abre el Excel y guárdalo de nuevo para que traiga los valores.`)
    }
  }

  return {
    entries,
    gastosIpv,
    cuentasPagadas,
    warehouse,
    templateOrigin,
    warnings,
    date,
    ingresosEntradaMesas,
    ventasDia,
    gananciaBruta,
    gananciaNeta: gananciaBruta - mermasCosto,
    mermasCosto,
    cuadre,
    departments,
    juegos,
    fondos,
    rh,
    rhFechas,
    totalRH: rh.reduce((s, e) => s + e.totalCobrar, 0),
    productCount,
  }
}

/**
 * Convierte el payload leído del IPV en el registro de día que la app
 * guarda (la misma forma que traen los días dentro de un respaldo del
 * SDA, que es como el servidor del sistema original conserva el payload
 * del día tal como entró). backupCore.normalizeDay lo consume igual en
 * modo local y en modo Supabase (payload), así que el día importado por
 * Excel y el día importado por respaldo son indistinguibles aguas abajo.
 */
export function ipvPayloadToRawDay(payload) {
  return {
    date: payload.date,
    ventasDia: payload.ventasDia,
    gananciaBruta: payload.gananciaBruta,
    gananciaNeta: payload.gananciaNeta,
    cuadre: payload.cuadre,
    mermasCosto: payload.mermasCosto,
    departments: payload.departments,
    entries: payload.entries,
    gastosIpv: payload.gastosIpv,
    cuentasPagadas: payload.cuentasPagadas,
    warehouse: payload.warehouse,
    templateOrigin: payload.templateOrigin,
    ingresosEntradaMesas: payload.ingresosEntradaMesas,
    juegos: payload.juegos,
    fondos: payload.fondos,
    rh: payload.rh,
    rhFechas: payload.rhFechas,
    totalRH: payload.totalRH,
    productCount: payload.productCount,
  }
}
