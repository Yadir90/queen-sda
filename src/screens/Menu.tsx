import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  applyMenuAvailability, applyMenuProfile, applyResetMenu, applySaveMenu,
  buildMenuCatalog, buildMenuDocData, buildMenuHistory, canonicalMenuSection,
  fmtMenuDayLong, groupMenuItems, menuFamiliesFor,
  menuHistoryCount, menuItemPrice, menuSectionLabel, productInitials,
  resolveMenuDoc, sortMenuItems, visibleMenuItems, buildAutoMenuDoc,
} from '../lib/menuCore.mjs'
import { menuHtml, fmtFechaDoc } from '../lib/documentosCore.mjs'
import { printHtml } from '../lib/download'
import { requireBiometricUnlock } from '../lib/webauthn'
import { exportNeedsBiometric } from '../lib/permissions'
import { logActivity } from '../lib/activityLog'
import { saveMenuState, supabaseConfigured } from '../lib/backend'
import { sbSaveMenuState } from '../lib/supabaseBackend'
import { BRAND_LOGO_URL } from '../lib/brandAssets'
import { productMediaKey } from '../lib/media'
import { MediaImage } from '../components/MediaImage'
import { Icon } from '../components/icons'
import type { MenuCatalogProduct, MenuDocState, MenuItem, MenuState, Section, StoredData } from '../types'
import { fmtInt } from '../lib/utils'
import { InfoHelp, TabHeader, TAB_BADGES, useCatalogLayout, ViewModeToggle } from '../components/ui'
import '../components/sectionsMirror.css'
import '../components/menuMirror.css'

const SB_MODE = supabaseConfigured()

/**
 * Menú del día — puerto del MenuTab del SDA original (D-R6-02,
 * reconstrucción completa; la versión anterior, D-R5-03, era una
 * derivación de solo lectura y el dueño lo reportó: «La pestaña
 * menu es diferente, nada sale igual»).
 *
 * Como en el original: el menú se genera solo desde «Productos»
 * (lo que tiene existencia, a su precio de venta vigente) y aquí
 * se deja listo para el cliente. Editar el menú NO toca el precio
 * real del producto, ni existencias ni ganancias: es solo la hoja
 * que se imprime. El documento se guarda por día y como base
 * reutilizable (día guardado → base → generado al abrir), con sus
 * textos (línea bajo el título y pie), la disponibilidad por
 * fecha y el Historial de no disponibles — todo en el estado
 * persistente de la pestaña (menuCore + capa de datos vigente).
 * El ojo de cada producto lo muestra u oculta en el menú (oculto
 * no sale ni en la vista previa ni en el PDF) y la familia que se
 * cambia queda aprendida en su perfil compartido. La regla de
 * cocina (nunca camarón, langosta, res ni tortuga) deja esos
 * productos fuera de todo el menú. Sin firma ni cuño.
 */
export default function MenuTab({ data, today, isAdmin, onChanged, onNavigate }: {
  data: StoredData
  today: string
  isAdmin: boolean
  onChanged: () => void
  onNavigate: (s: Section) => void
}) {
  const readOnly = !isAdmin
  const role = isAdmin ? 'admin' : 'lectura'
  const catalog = useMemo(() => buildMenuCatalog(data, data.menuState.profiles), [data])
  const catalogByKey = useMemo(
    () => new Map(catalog.products.map((p) => [p.productKey, p])),
    [catalog],
  )
  const [date, setDate] = useState(today)
  const [doc, setDoc] = useState<MenuDocState | null>(null)
  const [sourceLabel, setSourceLabel] = useState('')
  const [dirty, setDirtyState] = useState(false)
  const dirtyRef = useRef(false)
  const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v) }
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSection, setNewSection] = useState('')
  const [newFamily, setNewFamily] = useState('Por clasificar')
  const [newPrice, setNewPrice] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [layout, toggleLayout] = useCatalogLayout('sda-layout-menu', 'list')
  /* El editor (decenas de filas con campos y selectores) no se
     pinta en el primer instante: primero sale lo visible (textos y
     vista previa) y el editor entra justo después, como en el
     original, sin quitar ninguna función. */
  const [editorReady, setEditorReady] = useState(false)

  /* Al abrir la fecha: manda el menú guardado de ese día; si no
     hay, la base guardada; si tampoco, el generado desde
     «Productos». Los cambios sin guardar no se pisan cuando llega
     otra lectura (guarda `dirty` del original). La dependencia en
     `dirty` importa: al guardar, el refresco de datos puede llegar
     antes de que el aviso se apague, y el efecto debe re-resolver
     en cuanto el documento queda limpio. */
  useEffect(() => {
    if (dirtyRef.current) return
    const resolved = resolveMenuDoc(data.menuState, date, catalog.products)
    setDoc(resolved.doc)
    setSourceLabel(resolved.sourceLabel)
  }, [data.menuState, date, catalog, dirty])

  useEffect(() => {
    if (!doc) { setEditorReady(false); return }
    if (editorReady) return
    const t = setTimeout(() => setEditorReady(true), 60)
    return () => clearTimeout(t)
  }, [doc, editorReady, date])

  /* ---------- persistencia (la capa de datos vigente) ---------- */
  const persistState = async (next: MenuState, okMsg: string, failMsg: string) => {
    setBusy(true); setError(''); setMsg('')
    try {
      if (SB_MODE) await sbSaveMenuState(next)
      else saveMenuState(next)
      if (okMsg) setMsg(okMsg)
      onChanged()
      return true
    } catch {
      setError(failMsg)
      return false
    } finally { setBusy(false) }
  }

  const saveDoc = async (scope: 'day' | 'base') => {
    if (!doc) return
    const next = applySaveMenu(data.menuState, date, scope, doc)
    /* El documento queda limpio ANTES de persistir: así, cuando el
       refresco de datos llega, el efecto de resolución ya puede
       re-resolver desde lo guardado (si el guardado falla, el
       aviso de cambios sin guardar vuelve). */
    setDirty(false)
    const ok = await persistState(
      next,
      scope === 'base'
        ? 'Menú base guardado: los días sin menú propio arrancarán desde esta base. El precio real de «Productos» no se tocó.'
        : `Menú del ${fmtMenuDayLong(date)} guardado. Solo vale para esta fecha; para reutilizarlo otros días, guárdalo como base.`,
      'No se pudo guardar el menú ahora. Revisa tu conexión e inténtalo de nuevo.',
    )
    if (!ok) setDirty(true)
  }

  const resetDoc = async () => {
    setDirty(false)
    const next = applyResetMenu(data.menuState, date)
    const ok = await persistState(
      next,
      'Menú restablecido desde «Productos»: se borraron el menú de este día y la base guardada, y se regeneró con la existencia y los precios vigentes.',
      'No se pudo restablecer el menú ahora.',
    )
    if (ok) {
      setDoc(buildAutoMenuDoc(catalog.products))
      setSourceLabel('Generado desde Productos (existencia y precio vigente)')
    }
  }

  /* ---------- edición del documento ---------- */
  const updateItem = (key: string, patch: Partial<MenuItem>) => {
    setDoc((d) => (d ? { ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : d))
    setDirty(true)
  }

  const addProduct = (p: MenuCatalogProduct) => {
    setDoc((d) => {
      if (!d) return d
      const existing = d.items.find((i) => i.productKey === p.productKey)
      if (existing) {
        return {
          ...d,
          items: d.items.map((i) => (i.productKey === p.productKey
            ? { ...i, included: true, section: canonicalMenuSection(p.dept), family: i.family?.trim() && i.family !== 'Por clasificar' ? i.family : p.menuFamily }
            : i)),
        }
      }
      return {
        ...d,
        items: [
          ...d.items,
          {
            key: p.productKey,
            productKey: p.productKey,
            section: canonicalMenuSection(p.dept),
            family: p.menuFamily,
            name: p.name,
            price: p.precioVentaVigente,
            description: p.menuDescription,
            included: true,
            priceText: p.precioVentaVigente != null ? String(Math.round(p.precioVentaVigente)) : '',
          },
        ],
      }
    })
    setDirty(true)
  }

  /** Cambiar la familia de un producto desde el editor: queda
   *  aprendida en su perfil compartido y vale en el Menú de cada
   *  día, sin volver a preguntar (puerto de changeItemFamily). */
  const changeItemFamily = (i: MenuItem, family: string) => {
    const p = i.productKey ? catalogByKey.get(i.productKey) : undefined
    updateItem(i.key, { family: family === '__auto' ? p?.menuFamilyAuto ?? 'Por clasificar' : family })
    if (p) {
      const next = applyMenuProfile(data.menuState, p.productKey, { family: family === '__auto' ? '' : family })
      void persistState(next, `Aprendido: en adelante lo trato así. «${p.name}» queda en esa familia en el Menú de cada día, sin volver a preguntar.`, 'No se pudo guardar ese cambio del producto ahora.')
    }
  }

  const toggleHidden = (p: MenuCatalogProduct) => {
    const hidden = !p.menuHidden
    const next = applyMenuProfile(data.menuState, p.productKey, { menuHidden: hidden })
    void persistState(
      next,
      hidden
        ? `«${p.name}» oculto del menú (ojo cerrado): no saldrá en la vista previa ni en el PDF hasta que lo hagas visible con el mismo ojo. Sigue en Productos, en Existencias y aquí en la gestión; nada se borró.`
        : `«${p.name}» visible otra vez (ojo abierto): ya sale en el menú, en la vista previa y en el PDF.`,
      'No se pudo guardar ese cambio del producto ahora.',
    )
  }

  const toggleArchived = (p: MenuCatalogProduct, item: MenuItem | null) => {
    const archived = !p.catalogArchived
    if (archived && item) updateItem(item.key, { included: false })
    const next = applyMenuProfile(data.menuState, p.productKey, { archived })
    void persistState(
      next,
      archived
        ? `«${p.name}» archivado en el Historial compartido: no sale en el menú, pero no se borra.`
        : `«${p.name}» desarchivado: vuelve a la gestión del menú${p.currentStock > 0.001 ? ' y al menú de hoy' : ''}.`,
      'No se pudo guardar ese cambio del producto ahora.',
    )
  }

  const setProductAvailableToday = (p: MenuCatalogProduct, available: boolean) => {
    if (available) addProduct(p)
    else if (doc?.items.some((i) => i.productKey === p.productKey)) {
      updateItem(doc.items.find((i) => i.productKey === p.productKey)!.key, { included: false })
    }
    const next = applyMenuAvailability(data.menuState, date, p.productKey, available)
    void persistState(
      next,
      available
        ? 'Disponible hoy: quedó en el menú de este día con su familia y su orden alfabético, sin registrarlo de nuevo.'
        : 'Quitado del menú de hoy: el producto sigue guardado en el Historial con su familia, precios y descripción.',
      'No se pudo cambiar la disponibilidad de hoy. Revisa tu conexión e inténtalo de nuevo.',
    )
  }

  const addManual = () => {
    if (!newName.trim() || !doc) return
    const key = `manual-${Date.now()}`
    const name = newName.trim()
    setDoc({
      ...doc,
      items: [
        ...doc.items,
        {
          key,
          productKey: null,
          section: canonicalMenuSection(newSection.trim() || doc.items[0]?.section || 'Elaboración'),
          family: newFamily,
          name,
          price: Number(newPrice) > 0 ? Number(newPrice) : null,
          description: newDesc.trim(),
          included: true,
          priceText: newPrice.trim(),
        },
      ],
    })
    setNewName(''); setNewPrice(''); setNewDesc('')
    setDirty(true)
    setMsg(`«${name}» añadido al menú de hoy (solo existe en el menú: no crea producto ni existencia).`)
  }

  /* ---------- derivados (los del original) ---------- */
  const orderedItems = useMemo(() => (doc ? sortMenuItems(doc.items) : []), [doc])
  const includedItems = useMemo(() => orderedItems.filter((i) => i.included), [orderedItems])
  const visibleItems = useMemo(
    () => (doc ? visibleMenuItems(doc, catalogByKey) : []),
    [doc, catalogByKey],
  )
  const visibleGroups = useMemo(() => groupMenuItems(visibleItems), [visibleItems])
  const hiddenCount = useMemo(() => catalog.products.filter((p) => p.menuHidden).length, [catalog])
  const editorGroups = useMemo(() => groupMenuItems(orderedItems.filter((i) => i.included)), [orderedItems])
  const sectionNames = useMemo(() => [...new Set(orderedItems.map((i) => canonicalMenuSection(i.section)))], [orderedItems])
  const historyCount = useMemo(() => menuHistoryCount(doc, catalog.products), [doc, catalog])
  const historyEntries = useMemo(
    () => (historyOpen ? buildMenuHistory(doc, catalog.products, historySearch) : []),
    [historyOpen, doc, catalog, historySearch],
  )

  /* ---------- documento / correo ---------- */
  const runExport = async (action: () => void, label = 'un documento') => {
    if (!exportNeedsBiometric(role)) {
      action()
      logActivity('exportacion', `Exportó ${label}`, { section: 'menu' })
      return
    }
    const unlock = await requireBiometricUnlock()
    if (!unlock.ok) {
      setError(`Exportación cancelada: ${unlock.reason ?? 'la verificación biométrica no se completó.'}`)
      logActivity('fallido', `Exportación de ${label} cancelada: la verificación biométrica no se completó`, { section: 'menu' })
      return
    }
    action()
    logActivity('exportacion', `Exportó ${label}`, { section: 'menu' })
  }

  const sendMenuByEmail = () => {
    if (!doc) return
    if (visibleItems.length === 0) {
      setMsg(includedItems.length > 0
        ? 'Todos los platos del menú están ocultos (ojo cerrado): haz visible alguno con el ojo antes de exportarlo.'
        : 'El menú no tiene ningún plato incluido: añade o vuelve a incluir alguno antes de exportarlo.')
      return
    }
    void runExport(() => {
      const docData = buildMenuDocData(doc, catalog.products, date, fmtFechaDoc(date))
      const opened = printHtml(menuHtml(docData))
      setMsg(opened
        ? `Menú del ${fmtMenuDayLong(date)} generado como documento (PDF) desde la vista previa. El envío por correo aún no está conectado: no se envió ningún correo.`
        : 'El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para esta página e inténtalo de nuevo.')
    }, 'el menú (PDF)')
  }

  const thumb = (p: MenuCatalogProduct, small = false) => (
    <MediaImage
      kind="foto-producto"
      entityKey={productMediaKey(p.dept, p.name, p.um)}
      alt=""
      className={`menu-thumb${small ? ' menu-thumb-sm' : ''}`}
      fallback={<span aria-hidden="true" className={`menu-thumb${small ? ' menu-thumb-sm' : ''}`}>{productInitials(p.name)}</span>}
    />
  )

  return (
    <section>
      <TabHeader
        icon="doc"
        title="Menú"
        desc="Menú del día desde Productos, editable y en PDF"
        badge={TAB_BADGES.menu}
      />
      <div className="menu-page">
        <div className="menu-title-row">
          <h2 className="menu-title">
            Menú del día{' '}
            <InfoHelp label="Cómo funciona el Menú">
              Se genera solo desde «Productos» (lo que tiene existencia, a su precio de venta vigente) y aquí lo dejas listo para el cliente. Editar el menú <strong>no toca</strong> el precio real del producto, ni existencias ni ganancias: es solo la hoja que se imprime. El <strong>ojo</strong> de cada producto lo muestra u oculta en el menú: ojo abierto = visible; ojo cerrado = oculto, y no sale ni en la vista previa ni en el PDF hasta que lo vuelvas a hacer visible. Ocultar no borra nada: el producto sigue en Productos, en Existencias y aquí en la gestión. El precio que editas en cada fila es solo del menú: el real sigue en la ficha de «Productos». Dentro de cada familia el orden es alfabético y se coloca solo.
            </InfoHelp>
          </h2>
        </div>

        <div className="menu-card">
          <div className="menu-actions-row">
            <div>
              <label htmlFor="menu-fecha" className="menu-field-label">Fecha del menú</label>
              <input
                id="menu-fecha"
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value || today); setDirty(false); setDoc(null); setMsg(''); setError('') }}
                className="menu-input"
              />
            </div>
            {!readOnly ? (
              <>
                <button type="button" disabled={!doc || busy} onClick={() => void saveDoc('day')} className="menu-btn menu-btn-deep">Guardar menú de hoy</button>
                <button type="button" disabled={!doc || busy} onClick={() => void saveDoc('base')} className="menu-btn menu-btn-outline-deep">Guardar como base</button>
                <button type="button" disabled={!doc || busy} onClick={() => void resetDoc()} className="menu-btn menu-btn-outline">Restablecer desde Productos</button>
              </>
            ) : null}
            <button
              type="button"
              disabled={!doc}
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
              aria-controls="menu-historial"
              className="menu-btn menu-btn-outline-deep"
            >
              <Icon name="archive" size={16} /> Historial{historyCount ? ` (${historyCount})` : ''}
            </button>
            <button type="button" disabled={!doc} onClick={sendMenuByEmail} className="menu-btn menu-btn-accent">
              <Icon name="send" size={15} /> Enviar menú por correo
            </button>
          </div>
          <p className="menu-source-line">
            {sourceLabel ? <>En pantalla: <strong>{sourceLabel}</strong>. </> : null}
            Los cambios de hoy solo valen para esta fecha al guardarlos; «Guardar como base» los deja de punto de partida para los demás días.
            {dirty ? <> <strong className="menu-dirty">Tienes cambios sin guardar.</strong></> : null}
            {hiddenCount > 0 ? <> <strong>{hiddenCount} producto{hiddenCount === 1 ? ' oculto' : 's ocultos'} del menú</strong> (ojo cerrado): no salen en la vista previa ni en el PDF; siguen en el editor y en el Historial.</> : null}
          </p>
          {msg ? <p className="menu-msg" role="status">{msg}</p> : null}
          {error ? <p className="menu-error" role="alert">{error}</p> : null}
        </div>

        {historyOpen && doc ? (
          <div id="menu-historial" className="menu-card" aria-label="Historial de productos no disponibles hoy">
            <div className="menu-history-head">
              <div>
                <h3 className="menu-card-title" style={{ margin: 0 }}>Historial · no disponibles hoy</h3>
                <p className="menu-history-desc">Los productos registrados que hoy no están en el menú: sin existencia, archivados a mano en «Productos», ocultos con el ojo o retirados de este día. Es el mismo Historial de «Productos»: nadie se registra dos veces y, cuando un producto vuelve a tener existencia, sale solo en el menú ya clasificado y en orden alfabético. Los ocultos (ojo cerrado) se hacen visibles desde aquí o desde el editor, con el mismo ojo.</p>
              </div>
              <button type="button" onClick={() => setHistoryOpen(false)} className="menu-btn menu-btn-outline menu-btn-sm semibold">Cerrar historial</button>
            </div>
            <div className="menu-search">
              <span className="menu-search-icon"><Icon name="search" size={17} /></span>
              <input
                type="search"
                aria-label="Buscar en el historial del menú"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Buscar en el historial: Cristal, croquetas…"
              />
            </div>
            {historyEntries.length === 0 ? (
              <p className="menu-history-empty">{historySearch.trim() ? `Sin productos del historial que coincidan con «${historySearch.trim()}».` : 'Hoy no hay productos guardados fuera del menú: todo lo registrado está disponible.'}</p>
            ) : (
              <ul className={`catalog-layout ${layout === 'grid' ? 'catalog-layout-grid' : 'catalog-layout-list'}`} style={{ marginTop: 12 }} aria-label={`Historial del Menú en ${layout === 'grid' ? 'cuadrícula' : 'lista'}`}>
                {historyEntries.map((e) => (
                  <li key={e.key} className="catalog-card menu-history-card">
                    {e.product ? thumb(e.product) : (
                      <span aria-hidden="true" className="menu-thumb">{productInitials(e.name)}</span>
                    )}
                    <span className="menu-history-main">
                      <strong className="menu-history-name">{e.name}</strong>
                      <span className="menu-history-meta">
                        {menuSectionLabel(e.section)} · {e.family}
                        {e.price != null ? <> · venta {fmtInt(Math.round(e.price))} CUP</> : null}
                        {e.product?.precioCompraVigente != null ? <> · compra {fmtInt(Math.round(e.product.precioCompraVigente))} CUP</> : null}
                        {e.product ? <> · existencia {fmtInt(Math.round(e.product.currentStock))}{e.product.um ? ` ${e.product.um}` : ''}</> : null}
                      </span>
                      {e.description ? <span className="menu-history-desc2">{e.description}</span> : null}
                      <span className="menu-reason-chip">{e.availableToday ? 'En el menú de hoy por decisión tuya' : e.reason}</span>
                    </span>
                    {!readOnly ? (
                      <span className="menu-history-actions">
                        {e.product ? (
                          <>
                            {!e.menuHidden && (e.availableToday ? (
                              <button type="button" disabled={busy} onClick={() => setProductAvailableToday(e.product!, false)} aria-label={`Quitar ${e.name} del menú de hoy`} className="menu-btn menu-btn-outline menu-btn-sm">Quitar de hoy</button>
                            ) : (
                              <button type="button" disabled={busy} onClick={() => setProductAvailableToday(e.product!, true)} aria-label={`Poner ${e.name} disponible hoy en el menú`} className="menu-btn menu-btn-deep menu-btn-sm">Disponible hoy</button>
                            ))}
                            {e.product.menuHidden ? (
                              <button type="button" disabled={busy} onClick={() => toggleHidden(e.product!)} aria-label={`Hacer visible ${e.name} en el menú`} className="menu-btn menu-btn-deep menu-btn-sm"><Icon name="eye" size={14} /> Hacer visible</button>
                            ) : (
                              <button type="button" disabled={busy} onClick={() => toggleHidden(e.product!)} aria-label={`Ocultar ${e.name} del menú`} className="menu-btn menu-btn-outline menu-btn-sm"><Icon name="eyeOff" size={14} /> Ocultar del menú</button>
                            )}
                            {e.product.catalogArchived ? (
                              <button type="button" disabled={busy} onClick={() => toggleArchived(e.product!, e.item)} aria-label={`Desarchivar ${e.name} en Productos`} className="menu-btn menu-btn-outline-deep menu-btn-sm">Desarchivar</button>
                            ) : (
                              <button type="button" disabled={busy} onClick={() => toggleArchived(e.product!, e.item)} aria-label={`Archivar ${e.name} en el historial compartido`} className="menu-btn menu-btn-outline menu-btn-sm">Archivar</button>
                            )}
                          </>
                        ) : e.item ? (
                          <>
                            <button type="button" onClick={() => updateItem(e.item!.key, { included: true })} aria-label={`Poner ${e.name} disponible hoy en el menú`} className="menu-btn menu-btn-deep menu-btn-sm">Disponible hoy</button>
                            <button type="button" onClick={() => { setDoc({ ...doc, items: doc.items.filter((x) => x.key !== e.item!.key) }); setDirty(true) }} aria-label={`Borrar ${e.name} del menú`} className="menu-btn menu-btn-outline menu-btn-sm menu-btn-danger">Borrar</button>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="menu-history-note">El PDF del día exporta solo el menú disponible: el Historial nunca se imprime.</p>
          </div>
        ) : null}

        {!doc ? (
          <p style={{ fontSize: 14, color: 'var(--dim)' }}>Cargando el menú…</p>
        ) : catalog.products.length === 0 && doc.items.length === 0 ? (
          <div className="menu-empty">
            <strong>Todavía no hay productos para el menú</strong>
            <p>El menú sale de «Productos»: importa un IPV y lo que tenga existencia aparecerá aquí solo, agrupado por departamento y a su precio vigente.</p>
            <button type="button" onClick={() => onNavigate('productos')} className="menu-btn menu-btn-outline-deep">Ir a Productos</button>
          </div>
        ) : (
          <div className="menu-layout">
            <div style={{ minWidth: 0 }}>
              <div className="menu-card">
                <h3 className="menu-card-title">Textos del menú</h3>
                <div className="menu-texts-grid">
                  <div>
                    <label htmlFor="menu-subtitulo" className="menu-field-label">Línea bajo el título <span className="menu-optional">(opcional)</span></label>
                    <input
                      id="menu-subtitulo"
                      type="text"
                      maxLength={160}
                      value={doc.subtitle}
                      disabled={readOnly}
                      onChange={(e) => { setDoc({ ...doc, subtitle: e.target.value }); setDirty(true) }}
                      placeholder="Línea breve bajo el título"
                      className="menu-input menu-input-full"
                    />
                  </div>
                  <div>
                    <span className="menu-label-with-info">
                      <label htmlFor="menu-pie" className="menu-field-label">Pie del menú</label>
                      <InfoHelp label="Qué va en el pie del menú">Nombre del restaurante y, si quieres, dirección o contacto: se imprime al pie de cada página del PDF.</InfoHelp>
                    </span>
                    <input
                      id="menu-pie"
                      type="text"
                      maxLength={300}
                      value={doc.footerText}
                      disabled={readOnly}
                      onChange={(e) => { setDoc({ ...doc, footerText: e.target.value }); setDirty(true) }}
                      placeholder="La Reina Restaurante-Bar"
                      className="menu-input menu-input-full"
                    />
                  </div>
                </div>
              </div>

              <div className="menu-editor-head">
                <h3>Productos del menú</h3>
                <ViewModeToggle layout={layout} onToggle={toggleLayout} label="Productos del Menú" />
              </div>

              {!editorReady ? (
                <div className="menu-card" role="status"><p className="menu-editor-loading">Cargando el editor del menú…</p></div>
              ) : (
                <>
                  {editorGroups.map((g) => (
                    <div key={g.section} className="menu-section-block">
                      <h3 className="menu-section-title">{menuSectionLabel(g.section)}</h3>
                      {g.families.map((f) => (
                        <div key={f.family} className="menu-family-block">
                          <p className="menu-family-label">{f.family}{f.family === 'Por clasificar' ? ' — colócalos una vez y el sistema lo recuerda' : ''}</p>
                          <ul className={`catalog-layout ${layout === 'grid' ? 'catalog-layout-grid' : 'catalog-layout-list'}`} aria-label={`${f.family} en ${layout === 'grid' ? 'cuadrícula' : 'lista'}`}>
                            {f.items.map((i) => {
                              const prod = i.productKey ? catalogByKey.get(i.productKey) : undefined
                              const familyOptions = [...new Set([...menuFamiliesFor(i.section), i.family?.trim() || 'Por clasificar'])]
                              return (
                                <li key={i.key} className="catalog-card menu-item-card">
                                  <div className="menu-item-grid">
                                    <div className="menu-item-top">
                                      {prod ? thumb(prod, true) : null}
                                      <input
                                        type="text"
                                        aria-label={`Nombre en el menú de ${i.name}`}
                                        value={i.name}
                                        disabled={readOnly}
                                        onChange={(e) => updateItem(i.key, { name: e.target.value })}
                                        className="menu-item-name"
                                      />
                                    </div>
                                    <input
                                      type="text"
                                      aria-label={`Descripción breve de ${i.name}`}
                                      value={i.description}
                                      disabled={readOnly}
                                      onChange={(e) => updateItem(i.key, { description: e.target.value })}
                                      maxLength={240}
                                      placeholder="Descripción breve (opcional)"
                                      className="menu-item-desc"
                                    />
                                    <div className="menu-item-row2">
                                      <input
                                        type="text"
                                        min={0}
                                        step="any"
                                        aria-label={`Precio en el menú de ${i.name}`}
                                        value={i.priceText}
                                        disabled={readOnly}
                                        onChange={(e) => updateItem(i.key, { priceText: e.target.value })}
                                        placeholder="Precio"
                                        className="menu-item-price"
                                      />
                                      {i.productKey != null ? (
                                        <>
                                          <span className="menu-item-section-label">{menuSectionLabel(i.section)} ·</span>
                                          <label className="sr-only" htmlFor={`menu-familia-${i.key}`}>Familia de {i.name}</label>
                                          <select
                                            id={`menu-familia-${i.key}`}
                                            aria-label={`Familia en el menú de ${i.name}`}
                                            value={i.family}
                                            disabled={readOnly}
                                            onChange={(e) => changeItemFamily(i, e.target.value)}
                                            className="menu-item-select"
                                          >
                                            {prod ? <option value="__auto">Automática ({prod.menuFamilyAuto})</option> : null}
                                            {familyOptions.map((fam) => <option key={fam} value={fam}>{fam}</option>)}
                                          </select>
                                        </>
                                      ) : (
                                        <>
                                          <input
                                            type="text"
                                            aria-label={`Sección de ${i.name}`}
                                            value={i.section}
                                            disabled={readOnly}
                                            onChange={(e) => updateItem(i.key, { section: e.target.value, family: 'Por clasificar' })}
                                            list="menu-secciones"
                                            className="menu-item-section-input"
                                          />
                                          <label className="sr-only" htmlFor={`menu-familia-${i.key}`}>Familia de {i.name}</label>
                                          <select
                                            id={`menu-familia-${i.key}`}
                                            aria-label={`Familia en el menú de ${i.name}`}
                                            value={i.family?.trim() || 'Por clasificar'}
                                            disabled={readOnly}
                                            onChange={(e) => updateItem(i.key, { family: e.target.value })}
                                            className="menu-item-select"
                                          >
                                            {familyOptions.map((fam) => <option key={fam} value={fam}>{fam}</option>)}
                                          </select>
                                        </>
                                      )}
                                      {!readOnly ? (
                                        <span className="menu-item-actions">
                                          {prod ? (
                                            <button
                                              type="button"
                                              disabled={busy}
                                              onClick={() => toggleHidden(prod)}
                                              aria-pressed={prod.menuHidden}
                                              aria-label={prod.menuHidden ? `Hacer visible ${i.name} en el menú` : `Ocultar ${i.name} del menú`}
                                              title={prod.menuHidden ? 'Oculto del menú (ojo cerrado): toca para hacerlo visible' : 'Visible en el menú (ojo abierto): toca para ocultarlo'}
                                              className={`menu-eye-btn${prod.menuHidden ? ' is-hidden' : ''}`}
                                            >
                                              <Icon name={prod.menuHidden ? 'eyeOff' : 'eye'} size={15} /> {prod.menuHidden ? 'Oculto' : 'Visible'}
                                            </button>
                                          ) : null}
                                          <button type="button" onClick={() => updateItem(i.key, { included: false })} aria-label={`Quitar ${i.name} del menú`} className="menu-btn menu-btn-outline menu-btn-sm semibold">Quitar</button>
                                          {i.productKey == null ? (
                                            <button type="button" onClick={() => { setDoc({ ...doc, items: doc.items.filter((x) => x.key !== i.key) }); setDirty(true) }} aria-label={`Borrar ${i.name} del menú`} className="menu-btn menu-btn-outline menu-btn-sm semibold menu-btn-danger">Borrar</button>
                                          ) : null}
                                        </span>
                                      ) : null}
                                    </div>
                                    {prod?.menuHidden ? (
                                      <p className="menu-item-note strong"><Icon name="eyeOff" size={13} /> Oculto del menú: no sale en la vista previa ni en el PDF. Sigue en Productos y en Existencias; hazlo visible con el ojo cuando quieras.</p>
                                    ) : null}
                                    {i.productKey != null ? (
                                      <p className="menu-item-note">{prod?.menuFamilySource === 'aprendida' ? 'Familia fijada por ti: queda aprendida.' : prod?.menuFamilySource === 'automatica' ? 'Familia automática según el nombre; cámbiala una vez y queda aprendida.' : 'Sin familia reconocida: elige una y queda aprendida.'}</p>
                                    ) : null}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                  <datalist id="menu-secciones">
                    {[...new Set([...sectionNames, 'Elaboración', 'Bebidas alcohólicas', 'Bebidas no alcohólicas', 'Cantina', 'Pizzas'])].map((s) => <option key={s} value={s} />)}
                  </datalist>

                  {!readOnly ? (
                    <form
                      className="menu-card"
                      onSubmit={(e: FormEvent) => { e.preventDefault(); addManual() }}
                      aria-label="Añadir plato manual al menú"
                    >
                      <h3 className="menu-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        Añadir un plato a mano{' '}
                        <InfoHelp label="Qué es un plato a mano">Para algo que no está en «Productos» (un plato del día, por ejemplo). Vive solo en este menú: no crea producto, precio real ni existencia.</InfoHelp>
                      </h3>
                      <div className="menu-manual-grid">
                        <input type="text" aria-label="Nombre del plato manual" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre del plato" className="menu-input menu-input-full" />
                        <div className="menu-manual-row">
                          <input type="text" aria-label="Sección del plato manual" value={newSection} onChange={(e) => setNewSection(e.target.value)} list="menu-secciones" placeholder="Sección" className="menu-input menu-manual-section" />
                          <select aria-label="Familia del plato manual" value={newFamily} onChange={(e) => setNewFamily(e.target.value)} className="menu-input">
                            {menuFamiliesFor(newSection.trim() || 'Elaboración').map((fam) => <option key={fam} value={fam}>{fam}</option>)}
                          </select>
                          <input type="text" min={0} step="any" aria-label="Precio del plato manual" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Precio CUP" className="menu-input menu-manual-price" />
                        </div>
                        <input type="text" aria-label="Descripción del plato manual" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} maxLength={240} placeholder="Descripción breve (opcional)" className="menu-input menu-input-full" />
                        <button type="submit" disabled={!newName.trim()} className="menu-btn menu-btn-accent menu-manual-submit">Añadir al menú</button>
                      </div>
                    </form>
                  ) : null}
                </>
              )}
            </div>

            <div className="menu-preview-wrap">
              <h3 className="menu-preview-title">Vista previa (así sale el PDF)</h3>
              <div className="menu-preview" aria-label="Vista previa del menú del día">
                <div className="menu-preview-head">
                  <img src={BRAND_LOGO_URL} alt="Logo de La Reina" className="menu-preview-logo" />
                  <p className="menu-preview-brand">La Reina</p>
                  <p className="menu-preview-tag">RESTAURANTE - BAR</p>
                  <div className="menu-preview-rule" />
                  <p className="menu-preview-doctitle">Menú del día</p>
                  <p className="menu-preview-date">{fmtMenuDayLong(date)} · Precios en CUP</p>
                  {doc.subtitle.trim() ? <p className="menu-preview-subtitle">{doc.subtitle}</p> : null}
                </div>
                {visibleItems.length === 0 ? (
                  <p className="menu-preview-empty">{includedItems.length > 0 ? 'Hoy todos los platos están ocultos en el menú: no saldrán en el PDF hasta hacerlos visibles con el ojo.' : 'Hoy no hay platos incluidos en el menú.'}</p>
                ) : (
                  visibleGroups.map((g) => (
                    <div key={g.section} className="menu-preview-section">
                      <p className="menu-preview-section-title">{menuSectionLabel(g.section)}</p>
                      <div className="menu-preview-section-rule" />
                      {g.families.map((f) => (
                        <div key={f.family} className="menu-preview-family">
                          <p className="menu-preview-family-title">{f.family}</p>
                          <ul className="menu-preview-list">
                            {f.items.map((i) => (
                              <li key={i.key} className="menu-preview-item">
                                <span className="menu-preview-item-row">
                                  <span className="menu-preview-item-name">{i.name}</span>
                                  <span className="menu-preview-leader" />
                                  <span className="menu-preview-item-price">{menuItemPrice(i) != null ? fmtInt(Math.round(menuItemPrice(i)!)) : '—'}</span>
                                </span>
                                {i.description.trim() ? <span className="menu-preview-item-desc">{i.description}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))
                )}
                <p className="menu-preview-footer">{doc.footerText.trim() || 'La Reina Restaurante-Bar'}</p>
              </div>
              <p className="menu-preview-note">Esta es una primera versión para perfeccionarla contigo: dime qué secciones, textos o precios quieres ajustar y lo afino.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
