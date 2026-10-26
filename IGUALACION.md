# ACTUALIZACIÓN 2026-10-26 — OLEADA 2: ALMACÉN MANUAL REAL, INVENTARIO DE BIENES Y CIERRE DE LA FUGA DEL RESPALDO

Datos reales cargados por la coordinación en `supabase/modulos-extended-import.sql`
(app_settings `almacen-extended` y `venue-inventory`, media `foto-almacen` con 5
fotos por slug) y construidos aquí como módulos vivos del clon.

## Almacén manual (vista principal; la foto del IPV queda secundaria)
- La pantalla Almacén abre ahora con el módulo manual del original
  (`AlmacenTab`): conmutador Entrada / Rebajar producto, formularios
  «Entrada manual» (producto, cantidad, fecha, nota opcional) y «Rebaja
  manual» (producto con existencias, cantidad — nunca más que lo que
  queda —, fecha y «Para qué se cogió» obligatorio), «Existencias
  disponibles» CALCULADAS desde los movimientos (entrada suma, rebaja
  resta, orden alfabético) y «Registro de movimientos» en orden de fecha
  con su tipo, su motivo y su cantidad con signo.
- Datos mostrados: **19 movimientos reales** (4 productos: Papel
  sanitario 10−6=4 · Sazón frezko 14−12=2 · Codito 3−2=1 · Spageti
  8−5=3) y los metadatos de `warehouse_product_meta_v1` (6 claves:
  código de barras por producto, marca, categoría, descripción, fuente
  de imagen y estado de búsqueda — se muestra lo que cada ficha trae;
  Termómetro trae fuente y el resto, sobre todo códigos). Foto por
  producto desde la media (`foto-almacen`, slug del nombre).
- Alta/edición/baja SOLO admin, con confirmación de borrado y
  recálculo de existencias; persistencia: se reescribe la clave
  completa `app_settings 'almacen-extended'` en Supabase
  (`sbSaveWarehouseExtended`, patrón workers-extended) o el
  StoredData local (`saveWarehouseExtended`).
- La foto del IPV (existencias por foto, Salidas → Gastos con su regla
  de costo y registro de fotos) queda ÍNTEGRA como sección secundaria
  declarada al final de la pantalla; ya no es la vista principal.
- Diferencias honestas que quedan: sin escáner de códigos de barras
  con cámara ni búsqueda en internet del producto (los códigos reales
  se muestran desde los metadatos, la pantalla lo declara); las
  rebajas manuales NO crean gasto automáticamente en esta copia (esa
  sincronización almacén→gasto vive en el servidor del original y
  crearla aquí duplicaría gastos: la pantalla lo dice junto al
  formulario); sin foto de producto editable ni «Eliminar producto»
  como acción separada (borrar sus movimientos lo retira del cálculo).

## Inventario de bienes (destino propio)
- Nueva pantalla Inventario (entrar por Más — su tarjeta ya no dice
  «Siguiente fase» — y por la barra lateral): los **219 bienes reales**
  de `app_settings 'venue-inventory'` con los campos del original
  (`InventoryFields`): ID Inventario, fecha de adquisición, artículo,
  coste por artículo, cantidad, departamento, estado, clasificación,
  modelo, fabricante y observaciones. Lo que el dato no trae se
  muestra vacío o «—», nunca inventado (solo 19 bienes traen coste,
  21 fecha y 2 modelo: el «Valor conocido» suma solo los que traen
  coste, como en el original).
- Cabecera del original: Registros (219) · Cantidad activa · Valor
  conocido con «Suma solo los artículos con coste · N sin coste».
  Buscador (ID, artículo, departamento, modelo, fabricante,
  observaciones) y filtros por departamento y estado como en el
  original; la lista se agrupa por departamento (19 departamentos en
  el dato real). Foto desde la media por slug del nombre si la
  hubiera: el dato cargado no trae fotos de bienes y la ausencia se
  dibuja como ausencia (icono), sin fingir ninguna.
- Alta manual («El sistema asignará automáticamente el siguiente ID
  consecutivo» — la serie real continúa en IN0220) y edición, SOLO
  admin; persistencia: clave completa `app_settings
  'venue-inventory'` (`sbSaveVenueInventory`) o StoredData local
  (`saveVenueInventory`).
- Diferencias honestas: sin importar/actualizar desde Excel, sin PDF
  del inventario por correo y sin acciones separadas de «Dar de baja»
  y «Eliminar» del original (la baja se hace editando el estado a
  «Baja» en el mismo formulario de campos del original); sin foto del
  bien editable.

## Fuga del respaldo cerrada (integridad)
- El importador (`parseBackup`) descartaba y el exportador
  (`buildBackupExport`) vaciaba cinco colecciones que el respaldo SÍ
  trae. Ahora viajan ÍNTEGRAS de ida y vuelta, sin tocar su contenido
  (parseo = conservar el array tal como viene; reexportación = volcar
  el array guardado): **receivablePhotos 23 · smsLogs 15 · smsOutbox
  8 · monthlyArchives 1 · workerPayments 0** en el respaldo del
  24-oct. En modo Supabase se persisten en `app_settings
  'backup-collections'` al importar y se leen de ahí (no tienen tabla
  propia); en modo local viven en el StoredData.
- Las pantallas que las consumen las leen de ahí: Cobrar (eventos SMS
  en la cronología de la cuenta por `receivableId` + chip «SMS
  enviado» en la tarjeta morosa, como el original, y tarjeta de la
  última foto de cuentas de `receivablePhotos`), Queen → SMS (buzón
  real por categorías Enviados/Pendientes/Cancelados/Reenvíos desde
  `smsOutbox` + registro de envíos de `smsLogs`; enviar SMS nuevos
  sigue sin transporte y así se declara), Historial (tarjeta
  «Meses del archivo» desde `monthlyArchives`, tal como viajan, sin
  recalcular) y RH (sección «Pagos fuera de nómina (del respaldo)»
  desde `workerPayments`).
- Comprobación nueva en `scripts/verify-import.mjs`: ida-y-vuelta
  parse→export→parse con los esperados calculados DESDE el propio
  archivo leído y exigencia de contenido idéntico (JSON) en las
  cinco colecciones.
- Verificación de esta oleada: `npm run build` OK; batería completa
  en verde — verify:import (con la ida-y-vuelta nueva), verify:ipv,
  verify:rh-sync, verify:economia, verify:productos (32/32),
  verify:documentos (68/68), verify:queen (46/46),
  verify:automatizaciones (42/42) y verify:paridad (72/72).

---

# ACTUALIZACIÓN 2026-10-26 — PAQUETE DE CORRECCIÓN «ESPEJO» (mandato del dueño, 25-oct 23:44/23:47: «que sea el mismo con todo, un espejo, un clon del que diseñamos aquí» / «Haz una copia exacta de todo el sistema»)

Las cuatro áreas se rehicieron POR PUERTO del código del original
(`~/workspace/ts-spaces/panorama-mensual-la-reina/client/src/`): componentes,
clases, keyframes y valores copiados literalmente donde la arquitectura del
clon (Vite + Supabase/localStorage, sin servidor del artefacto) lo permite.
Lo que sigue es el registro por pantalla: qué se espejó, con qué verificación,
y qué diferencia honesta sobrevive y por qué.

Verificación nueva de coordinación: `npm run verify:paridad` (56
comprobaciones sobre el código Y sobre el JS/CSS construido): piezas de
Sistema (OrganismMap, hélice `dna-helix` literal con doble recorrido de
luces, radar, StartupTimeline, simulación, banco de errores), estructura de
la consola de Queen, bloques de Inicio/Días/Cobrar, las 19 secciones de Más,
pantalla de arranque y ausencia de la entrada «Cuentas». Batería previa
completa en verde tras el paquete: import, ipv (36/36), rh-sync, economía,
productos (32/32), documentos (68/68), queen (46/46), automatizaciones
(42/42). Auditoría visual sintética (Chromium headless por CDP, app en modo local
sembrada con el respaldo real, 15 pantallas × claro/oscuro × 360 px y
1280 px = 60 combinaciones): CERO desbordes horizontales tras corregir el
único defecto cazado (la píldora de selección del ADN desbordaba a 1280 px
porque la cabecera no heredaba el `flex-wrap: wrap` del ámbito
`.system-network-system` del original; corregido en `systemMirror.css`).

## Arranque y navegación (compartido)
- Pantalla de arranque `queen-boot-screen` LITERAL del original (reactor,
  «Preparando el sistema», «Queen está conectando tus datos…», barrido
  `queen-boot-scan` .85 s, panel `queen-boot-slow` a los 7 s con «Reintentar
  ahora»). SIN anillos decorativos: el original los eliminó por corrección
  del dueño del 2026-10-18; el reactor va solo.
- Fallback de Suspense con reactor y barra de progreso indeterminada.
- La entrada «Cuentas» de la barra lateral NO existe en el original como
  pestaña: eliminada. `Cuentas.tsx` queda como destino interno (abre Cobrar
  en vista Clientes con el contexto de persona), igual que en el original.

## Sistema
Espejado: sin TabHeader; reloj SOLO en Monitor (LiveClockCard 12 h);
«De un vistazo» (aquí, no en Inicio) con radar de 8 áreas y salud = media de
los 15 segmentos de ADN del original (100/72/38/1 por segmento); organismos
vivos: OrganismMap (silueta SVG, latido, 12 partes literales), DnaHelix (doble
hélice `dna-helix` literal: cintas con paths del original, dos luces viajeras
con animateMotion de 4.6 s en recorridos opuestos, bases por pares de ancho,
selección con píldora informativa y línea de mutaciones con datos reales),
QueenBrain (red neuronal en las posiciones literales + IpvNeuralMap con sol,
3 anillos y planetas por día real de IPV; etapa CALCULADA con
`buildQueenEvolution`, ya no fija), IntegrationMap literal navegable,
simulación que EJECUTA los 8 escenarios deterministas del original sobre los
datos reales, banco de errores (células de errores de queenCore + centinelas
de integridad + historial), StartupTimeline con tiempos medidos de
`performance`, Organizador persistente, Rendimiento y Día×hora alimentados
por lecturas sembradas de las jornadas REALES del respaldo (una por jornada;
memoria y latencia NO se inventan: quedan «sin dato» hasta que existan
lecturas reales).
Diferencias honestas:
- La imagen WebP del cerebro del artefacto no existe en el clon: se usa la
  misma red neuronal en las posiciones literales del original (coordenadas
  y paleta copiadas).
- Sin Recharts (rendimiento en el A16 y peso): gráficos en SVG/HTML nativo
  con la misma raíz visual, pestañas y leyendas del original.
- StartupTimeline usa clases CSS propias de igual valor visual (el clon no
  usa Tailwind).
- El planeta de un día IPV no ofrece descarga: el respaldo no conserva los
  bytes del Excel original.
- Sin botón de «intervención inmune»: en el original lo ejecuta el servidor;
  en esta copia no hay servidor que la ejecute y no se simula.
- Los nodos «Gastos» y «Otros ingresos» del mapa de integración abren
  Economía (en el original abren Gastos/OtrosIngresos, pantallas que el clon
  no tiene como destino propio).
- Señales que NO viajan en el respaldo y se declaran «No viaja en el
  respaldo» sin inventar valor: patrones reconocidos, acciones autónomas,
  tasa de precisión y el detalle de versiones del ADN con checksum (sí se
  muestran la etapa actual y su progreso, derivados del respaldo).
- La hora de las jornadas sembradas de Rendimiento se agrupa a las 12:00
  (el respaldo no conserva la hora exacta de cada lectura): declarado en la
  propia vista.
- Paneles de actividad y notificaciones: muestran el estado real de ESTA
  copia y declaran que no hay actividad de servidor ni cola de avisos en
  vivo (las funciones en la nube siguen diferidas por decisión del dueño).
- Organizador: en el clon persiste en localStorage del dispositivo; se
  declara en la vista que no hay guardado en servidor hasta desplegarlo.

## Queen
Espejado: consola sin TabHeader con cabecera propia (orbe a 46 px en la
etapa calculada, título, subtítulo literal, borrado del hilo con
confirmación armada y «…»); franja de evolución con chips de 5 estados por
índice; barra de chips Anticipación / Sugerencias / SMS / Memoria con
contadores reales y un panel cada vez; hilo puerto de QueenThread (orbe de
Queen con anillos por etapa, nombre «Queen», hora, avatar del usuario por
iniciales, responder citando con cita en la burbuja, «Cómo lo comprobé» con
línea de verificación real y confianza derivada de ella
(`deriveQueenAnswerMeta`), tarjetas accionables (Navegar/Aplicar), feedback
Sí/No con «Aprender corrección» que GUARDA la corrección y la APLICA en
respuestas posteriores (`applyQueenLearnedCorrections`), indicador de
escribiendo de 3 puntos tras 550 ms de «pensando», burbujas teñidas por
etapa); historial (últimos 30), frecuentes y borrador persistidos con las
claves del original; composer fijo con popover de preguntas rápidas (las 4
literales del original + las del clon); Anticipación = puerto fiel de
`buildQueenAnticipations` con las fuentes de datos del clon; Sugerencias =
las 4 fuentes reales del clon; Memoria dentro del panel de chips.
Diferencias honestas:
- SMS de cobro: bandeja literal y conteos reales, pero el envío y el buzón
  dependen del backend del original y de la aprobación en Android; cada
  fila declara «Sin transporte en esta copia». Nunca se simula un envío.
- Mensajes automáticos del sistema (boletín/cierre/respaldo) y borrado del
  hilo en servidor: la API del original no existe en el clon; el borrado es
  local y así lo dice el pie.
- Foto de perfil del usuario: no viaja en los datos → avatar por iniciales
  de 28 px con la misma estructura.
- Corrector ortográfico del original (`useSpellcheck`): no existe en el
  clon → atributo nativo `spellCheck`.
- Estados del orbe «working»/«expectant» por actividad en vivo: no viajan;
  «working» sí se muestra mientras Queen piensa.
- Las acciones de los avisos de Anticipación preguntan en el hilo en vez de
  navegar (QueenScreen no recibe navegación del App en el clon).
- Clases de utilidad Tailwind del hilo original → equivalentes locales
  marcados en `queenMirror.css`; el `.queen-chat` heredado de index.css
  queda anulado dentro de la consola.

## Inicio
Espejado: DayTimeline + NightCloseConsole literales («El día y su cierre»:
cinta 10:00–22:00 con ahora/eventos/cierre y pasos IPV/cuadre/gastos/boletín
con acciones reales); comparador de períodos literal con DeptCompareChart y
BucketCompareChart; «El río de caja» (CashBars) y «Gastos por categoría»
(LuminousBars) portados con sus algoritmos literales (`buildRiver`,
`buildCategoryBars`); «De dónde salen los totales de cuentas» literal;
«De un vistazo» ELIMINADO de Inicio (vive solo en Sistema; el del clon
promediaba 3 comprobaciones inventadas como salud); «Resumen de hoy» con la
lista y los iconos del `smartSummaries` literal y la animación vital del
original (fxVitalSerene 4.6 s / fxVitalAlert 1.7 s por urgencia).
Diferencias honestas:
- Clases Tailwind del original → clases `hm-*` con los valores exactos
  (el clon no usa Tailwind).
- Eventos con hora de la cinta del día: solo existen los boletines de hoy
  con `sentAt`; el clon no tiene buzón de salida del artefacto.
- Sin eventos de avisos de Queen en la consola de cierre: Inicio no recibe
  `queenAlerts` en el clon; la fila usa el estado real de boletines.
- CashBars/LuminousBars viven en el original dentro de Economía/Gastos; en
  el clon quedan portados y exportados en `charts.tsx` y usados por Inicio.

## Días
Espejado: detalle de RH por trabajador (nombre, ocupación, días sin
redondear, horas = días × 12, a cobrar) con totales y línea de fundamento
(`rhFechas`); botón «Descargar el día» que entrega el resumen completo del
día en texto con todas sus cifras reales.
Diferencia honesta:
- «Eliminar el día» NO se incluye: ni el backend local ni el Supabase del
  clon exponen `deleteDay` ni la autorización reforzada del original
  (`authorizeSensitiveAction("delete-ipv")`); simularlo sería falso.
- La descarga no es el «IPV actualizado» xlsx del original (el respaldo no
  conserva el Excel): es el resumen completo del día en .txt.

## Cobrar / Cuentas
Espejado: cronología expandible literal (cuenta creada + abonos con el saldo
tras cada paso) y tarjeta de comprobante (ReceiptPreviewCard) literal en
modal, desde la cronología y desde Comprobantes.
Diferencias honestas:
- Comprobantes del servidor del original (`listPaymentReceipts` con estado
  de envío y reenvío) no existen en el clon: la misma tarjeta se construye
  desde el abono real y declara que no hay estado de envío en esta copia.
- Avatar con foto / `defaultPersonAvatar`: la foto no viaja → iniciales con
  la paleta existente.
- La cronología no incluye «arrastre a nueva quincena»:
  `workerCycleStart` no viaja en el respaldo. (Los eventos de SMS SÍ
  llegaron en la oleada 2: `smsLogs` viaja íntegro y la cronología los
  muestra, con el chip «SMS enviado» en la tarjeta morosa.)

## Economía
Rehecha como la EconomiaTab del original: 9 bloques con EconomyMeters
primero (fórmulas del propio original: meta diaria, reserva del 10 %,
punto de equilibrio con coste fijo diario real), flujo operativo con su
avisos, punto de equilibrio, rentabilidad por categoría, 6 indicadores,
impacto administrativo, participación de gastos y evolución de márgenes.
Se conservan el cierre del dueño, las quincenas naturales y el alta de
gasto del clon.
Diferencias honestas:
- El selector agrega por MES completo: el núcleo local no agrega por
  período arbitrario como el servidor del original.
- Anomalías de Queen: se muestran con el botón deshabilitado y el motivo
  (el endpoint de la nube sigue sin desplegar, por decisión del dueño).
- Sin botón «Ver el detalle en Cobrar»: la pantalla no recibe navegación.

## Elaboración
Puerto de ProductsByArea + Elaboración del original: pestañas, panel de
área con buscador, rejilla con insignia NUEVO y orden por precio; rentabilidad
real por plato con Comparar; sin bordes de color por estado (el original no
los usa).
Diferencias honestas:
- Solo se muestran las fichas cuando el catálogo y los gastos permiten
  construirlas: las fichas de costo del original no viajan en el respaldo.
- Sin crear producto manual ni importación/exportación de fichas Excel
  (parser del artefacto).

## Productos
«Stock bajo» literal con el umbral del original; rentabilidad por ganancia
histórica descendente; cambios de precio con la fuente real («Respaldo del
SDA»/«Hoja RH»/«IPV» + fecha); Activos/Historial; «Diferencias explicadas».
Diferencias honestas:
- Sin códigos de barras ni foto: no viajan en el respaldo.
- La frase «(había X a ese costo)» del original no se incluye: el núcleo
  del clon no expone la existencia previa a ese costo.

## Almacén
ACTUALIZADO en la oleada 2 (ver la sección nueva al principio de este
documento): el módulo manual del original ya es la vista principal
(19 movimientos reales, existencias calculadas, metadatos, CRUD admin
persistido en app_settings 'almacen-extended') y la foto del IPV queda
como sección secundaria declarada. Diferencias que quedan: sin
escáner de códigos de barras con cámara ni búsqueda en internet del
producto, y las rebajas manuales no crean gasto automáticamente en
esta copia (declarado en pantalla junto al formulario).

## Laboratorio
Reescrito como puerto de LaboratorioTab del original (el clon tenía un
simulador de 40 filas que no existe en el original: eliminado).
Diferencias honestas:
- Sugerencias calculadas con `buildPriceSuggestions` local; los factores
  por categoría del servidor del original no viajan.
- IpvLabPanel sin subir IPV (el clon no tiene el parser/roundTrip/cola del
  artefacto).

## RH
Héroe de ciclo del original, columna «Salario diario», banner de ciclo
cerrado/abierto, aviso de pago a trabajador con 0 días, banda total y
leyenda de cuadrados con su significado; la «A» de ausencia NO se pinta
como estado porque el registro de jornada no viaja (declarado en la
leyenda). El PDF de nómina sigue viviendo en Documentos (la pantalla no
imprime). La ficha simplificada de trabajador es decisión registrada del
dueño, no una omisión.

## Transferencias
Pase precargado con TODO el saldo por defecto (dinámica del formulario del
original) y acceso «Usar todo el saldo».
Diferencia honesta: no se puede editar un movimiento (el backend local y el
de Supabase del clon solo añaden/excluyen); los formularios separados del
original quedan cubiertos por el formulario único real del clon.

## Documentos
No es una pestaña del original: es la consolidación del clon, declarada
como tal. Chips de mes legibles («octubre de 2026»). Entrega de documentos
en el navegador en vez de «Archivo listo» con PDF de servidor (el generador
vive en el servidor del original); firmas y cuño con los textos honestos
del propio original («pendiente de trazo real», «cuño digital no
disponible en esta copia»).

## Historial
Puerto de HistorialMonthGrid: rejilla del mes con huecos por lunes, anillo
dorado para hoy, doble anillo para el día seleccionado, verdes sólidos del
original (#23aa70) y leyenda.
Diferencia honesta: el envío real de boletines por correo espera las
funciones en la nube diferidas por decisión del dueño; no se simula la
retención de 30 minutos del original.

## Más / Secciones
Las 19 secciones del original con nombre, icono y descripción tomados de
su propia lista de pestañas (`tabs` de App.tsx), sin «Cuentas» ni
«Documentos» como tarjetas (no son secciones del original) y con
«Existencias» restaurada como en el original.

---

# IGUALACION.md — Especificación de igualación visual e interactiva

**Objetivo:** que la app externa (`~/workspace/queen-sda-app/`) quede igual al sistema
original Queen SDA — aspecto **e interactividad de los gráficos** — pantalla por pantalla.

**Fuentes usadas (todas reales, leídas del disco):**

- Original: `~/workspace/ts-spaces/panorama-mensual-la-reina/client/src/`
  (`App.tsx` 26.688 líneas, `theme.css` 11.267 líneas, `charts.tsx`, `futureCharts.tsx`,
  `docStyle.ts`, `manifest.webmanifest`). El código del artefacto **sí** está accesible.
- Externo: `~/workspace/queen-sda-app/src/` (`App.tsx`, `index.css`, `components/ui.tsx`,
  `screens/*.tsx`).
- Los informes de referencia del 22-oct (`referencia-interfaz-queen-sda.md`,
  `informe-funcionamiento-sistema-queen-sda.md`) **no se pudieron usar**: en
  `~/workspace/your_files/` son enlaces simbólicos a
  `~/workspace/goals/panorama-mensual-la-reina/files/…` y esa carpeta `files/` está
  **vacía** en disco. Toda esta especificación sale del código fuente, no de los informes.

Regla de oro que se repite en todo el original: **nada se inventa** — un dato ausente se
dibuja como ausencia (tono vacío, punteado, «sin verificar»), nunca como cero ni relleno.

---

## 0. Tokens globales del original (extraídos de `theme.css`)

### 0.1 Paleta — modo claro (`:root`)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#f2f7f4` | fondo base |
| `--surface` | `#ffffff` | tarjetas |
| `--surface-alt` | `#e8f1ec` | superficies alternas / pista del anillo |
| `--surface-tonal` | `#ecf4f0` | fondos tonales, pistas de barras |
| `--turquoise` | `#0ea5bd` | turquesa del logo |
| `--turquoise-soft` | `#e0f4f2` | fondos suaves, cápsula activa de nav |
| `--text` | `#122019` | texto |
| `--dim` | `#57705f` | texto secundario |
| `--border` | `#dde8e1` | bordes hairline |
| `--accent` | `#0e9f6e` | esmeralda, acento principal |
| `--on-accent` | `#041f16` | tinta sobre acento (contraste AA) |
| `--deep` | `#0b3d2e` | verde profundo: títulos/cifras clave, botones primarios |
| `--deep-2` | `#0e5240` | verde profundo secundario |
| `--gold` | `#c9a227` | dorado: hoy, punta, avisos |
| `--danger` | `#ba1a1a` | errores, morosas, badges |
| `--danger-soft` | `#fdecea` | fondo de peligro |
| `--warn-soft` | `#fff6e0` | fondo de aviso |
| `--paid` / `--paid-soft` / `--paid-border` / `--paid-text` | `#2563eb` / `#dbeafe` / `#93c5fd` / `#1e40af` | cuentas pagadas (azul) |
| `--queen-chat-user-bg` | `#0b7285` | burbuja del usuario en el chat de Queen |
| `--queen-chat-assistant-bg` | `#087a55` | burbuja de Queen |

### 0.2 Paleta — modo oscuro (`prefers-color-scheme: dark`)

`--bg #0a1411` · `--surface #15241e` · `--surface-alt`/`--surface-tonal #1c2f27` ·
`--turquoise #2dd4ee` · `--turquoise-soft #14383b` · `--text #eaf5f0` · `--dim #9dbcae` ·
`--border #273f33` · `--accent #22c55e` · `--deep #0b3d2e` · `--deep-2 #11543f` ·
`--danger #ff8a80` · `--danger-soft #3a1d1d` · `--warn-soft #3a3117` ·
`--paid #60a5fa` · `--paid-soft #1e3a5f` · `--paid-border #3b82f6` · `--paid-text #bfdbfe` ·
chat Queen `#0e7c93` / `#0f7d58`.

El tema lo elige el dispositivo (`prefers-color-scheme`); la app **nunca oscurece nada
por su cuenta**.

### 0.3 Fondo aurora (firma visual del sistema)

Variable `--ambient-bg`, pintura CSS **estática**: sin `backdrop-filter`, sin desenfoque,
sin animación (regla de rendimiento para el Galaxy A16). Seis manchas radiales + degradado
lineal base:

- Claro: turquesa `rgb(14 165 189 / .17)` arriba-derecha · esmeralda `rgb(14 159 110 / .16)`
  arriba-izquierda · azul `rgb(59 130 246 / .10)` arriba-centro · esmeralda `.10` derecha ·
  turquesa `.13` abajo-izquierda · violeta `rgb(139 92 246 / .11)` abajo-derecha ·
  lineal `168deg, #edf7f0 → var(--bg) 44% → #e8f3f5`.
- Oscuro: mismas posiciones con `#2dd4ee`/`#22c55e` atenuados (.05–.09) y lineal
  `#0c1813 → var(--bg) 46% → #0a1518`.
- Las barras fijas (cabeceras, buscadores pegajosos, nav) usan la clase
  `.ambient-bar-surface`: **la misma aurora fija de la página**, para que no haya franja
  distinta al hacer scroll y el contenido no se transparente.

### 0.4 Tipografía

- Base: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (theme.css:201).
- `--font-display: Georgia, "Times New Roman", serif` — **titulares y cifras clave**
  (clase `font-display` en títulos de tarjeta, cifras grandes, cabeceras).
- Escala (Tailwind `@theme`): xs 12/16 · sm 14/20 · base 16/24 · lg 18/28 · xl 20/28 ·
  2xl 24/32 · 3xl 30/36 · 4xl 36/40.
- Cifras con `tabular-nums`; la cifra héroe de tarjeta usa
  `clamp(2rem, 9vw, 3.4rem)`, peso bold, tracking −0.035em.

### 0.5 Radios, sombras, botones

- `--radius: 24px` · `--card-radius: 26px` · `--card-radius-compact: 22px`
  (en pantallas compactas las tarjetas bajan a 22px — theme.css:809).
- `--card-shadow: 0 1px 2px rgb(11 61 46 / .05), 0 10px 28px rgb(11 61 46 / .045)`
  (oscuro: `0 1px 2px rgb(0 0 0 / .2), 0 12px 30px rgb(0 0 0 / .16)`). Sombra apenas
  perceptible; **los botones no llevan sombra**.
- Botones de acción: cápsula (`rounded-full`), primario `--deep` con texto blanco o
  `--accent`; altura táctil mínima 40–48px (`min-h-10/11/12`).
- Botón «+» por pestaña (Inicio/Gastos/Almacén): círculo de 56px, fondo `#0B7285`, icono
  `plus` blanco — **al final del contenido, en el flujo** (no flotante), solo en móvil.

### 0.6 Colores de gráficos (`theme.css` §544 y `charts.tsx`)

`--chart-green #0e9f6e` · `--chart-deep #0b5d46` · `--chart-turquoise #0e9db3` ·
`--chart-gray #93a59a` · `--chart-sage #6da889` · `--chart-mint #42c596` ·
`--chart-slate #73877b` · `--chart-forest #287c5c`.
Degradado de las barras de niveles (verde→naranja, el de Samsung Health que pidió el
dueño): `linear-gradient(90deg, #2fbf71, #a8c256, #e9a13b)`.

---

## 1. Sistema de iconos del original — SVG propio, **cero emoji en la UI**

El original dibuja **todos** sus iconos con un único componente `Icon`
(App.tsx:1016): SVG `viewBox 0 0 24 24`, `fill none`, `stroke currentColor`,
`strokeWidth 1.8`, extremos redondos. Hay **36 iconos** definidos (`ICON_PATHS`,
App.tsx:977-1015). Los puntos de aviso se dibujan con un punto de color (`AlertDot`),
explícitamente «sustituye a los emoji».

Iconos por pestaña (nombre exacto del path en el código):

| Pestaña (id) | Etiqueta | Icono |
|---|---|---|
| panorama | Inicio | `dashboard` |
| cobrar | Cobrar | `wallet` |
| queen | Queen | `sparkle` — pero se renderiza el **orbe Reactor** (ver §2.3) |
| sistema | Sistema | `sparkle` |
| mas | Más | `more` (tres puntos rellenos) |
| ajustes | Ajustes | `settings` |
| almacen | Almacén | `package` |
| archivo | Archivo | `archive` |
| cronologia | Cronología | `list` |
| dias | Días | `calendar` |
| economia | Economía | `chart` |
| elaboracion | Elaboración | `receipt` |
| entradas | Entradas | `package` |
| gastos | Gastos | `receipt` |
| historial | Historial | `clock` |
| importar | Importar | `upload` |
| inventario | Inventario | `archive` |
| laboratorio | Laboratorio | `flask` |
| menu | Menú | `doc` |
| extras | Otros ingresos | `plus` |
| productos | Productos | `package` |
| rh | RH · Pagos | `people` |
| transferencias | Transferencias | `transfer` |

Resto del set (acciones/estados): `download`, `edit`, `trash`, `alert`, `check`, `x`,
`chevronL`, `chevronR`, `clock`, `money`, `search`, `send`, `eye`, `eyeOff`, `info`,
`star`, `phone`, `message`, `camera`, `grid`.

**Identidad de Queen — «Reactor Evolutivo»** (`futureCharts.tsx:439-586`,
`QueenReactorMark` + `QueenOrb`, App.tsx:1275): marca SVG animada por CSS (respiración,
sin librerías), 5 etapas con color propio — `celula` (Embrión), `infante` `#3B82F6`,
`juvenil` (Joven) `#F0564F`, `adulto` `#EAB308`, `maduro` `#C084FC` — y estados
(`idle`, `thinking`, `alert`, `suggestion`…) y salud. En la barra inferior el orbe va a
35px (27px en la lateral), **sin cápsula de fondo ni aro** alrededor, con sombra neutra
tenue. Las ilustraciones aprobadas por etapa viven en
`client/src/assets/queen-evolution/*.webp`. El icono PWA del original es
`client/public/icons/sad-192.png` / `sad-512.png` (manifest.webmanifest) y el logo del
local `client/src/assets/la-reina-logo*.png/jpg`.

---

## 2. (a) Especificación por pantalla — ORIGINAL

### 2.0 Estructura común a todas las pantallas

- **Barra inferior móvil** (`.oneui-bottom-nav`, oculta en ≥xl): pastilla flotante —
  `left/right 12px`, `bottom max(10px, safe-area)`, **radio 30px**, sombra suave
  `0 12px 32px rgb(8 76 92 / .16)…`, fondo `.ambient-bar-surface`. 5 botones en rejilla
  (máx. 576px centrado), altura mínima 64–68px, etiqueta 11px.
  Orden: **Inicio `dashboard` · Cobrar `wallet` · Queen (orbe) · Sistema `sparkle` · Más `more`**.
  - Activa: etiqueta en negrita color `#084C5C`, cápsula `turquoise-soft` bajo el icono;
    inactiva: `--dim`, peso medio. El SVG activo gana grosor (2.55) y leve sombra.
  - **Puntos ambientales** bajo Inicio/Cobrar/Sistema (`tab-ambient-dot`): verde ok,
    ámbar aviso, rojo problema — estado real, no decoración.
  - **Badges numéricos** en Cobrar (pendientes), Queen (avisos) y Sistema (avisos):
    pastilla `--danger`, texto blanco 9px, esquina superior derecha.
  - Queen en el centro: orbe de 35px que sobresale (−16px), sin fondo.
- **Barra lateral escritorio** (≥xl, `aside` fija 288px, `.ambient-bar-surface`): logo
  48px radio 16 + «Queen SDA / Sistema de Automatización de Datos V2.0»; fila de perfil
  (foto 44px, nombre, rol — lleva a Ajustes); dos grupos: **Principal** (Cobrar, Gastos,
  Inicio, Queen) y **Más secciones** (las otras 18, **orden alfabético en español**);
  botones cápsula de 48px con icono 20px y badge; pie con resumen de días/cuentas.
  El contenido lleva `xl:pl-72`.
- **Cabecera de pestaña** (`.tab-header`, componente `TabHeader`, igual en TODAS):
  tarjeta radio 26px con degradado `linear-gradient(135deg, turquoise-soft, surface 62%)`,
  sombra de tarjeta; insignia con el icono de la sección a 26px, título `font-display`
  en negrita, descripción breve en `--dim` y **chip distintivo** propio
  (p. ej. Inicio «Tablero principal», Cobrar «Dinero en la calle», Sistema «Núcleo de
  Queen», Días «Detalle por día», RH «Ciclos de 15 días»). Sin buscador general
  (eliminado por orden del dueño; cada sección conserva el suyo).
- Aviso de cambio de contraseña inicial (si aplica) y botón «← Más» en móvil dentro de
  las secciones de Más. Modo concentrado solo en Importar y Cobrar.
- Cada pestaña va protegida por un `TabErrorBoundary` propio con salida a Inicio.

### 2.1 Inicio (`panorama`) — orden exacto de bloques

1. **Selector de período** (`PeriodNav`): tipos Día/Semana/Quincena/Mes/Trimestre con
   flechas de desplazamiento y «ir al actual». La **Quincena abre la última cerrada**,
   no la en curso. Nota al pie sobre los ciclos de RH (15 días exactos) ≠ quincena natural.
2. **Línea de cobertura**: días importados del período y huecos con fecha («un día
   ausente no cuenta como venta 0»).
3. Botones **PDF del período** (acento) y **Presentación PowerPoint** (borde `--deep`).
4. **«Este mes vs el anterior»** (solo mes): 4 mini-tarjetas (Ventas, Ganancia bruta,
   Ganancia neta, Resultado) con delta coloreado y pastilla de % de ventas.
5. **Acciones rápidas** (`.home-quick-grid`): Importar IPV `upload` · Nuevo gasto `plus`
   · Ver cuentas `wallet` (con conteo de pendientes).
6. **Resumen de hoy** (`.smart-summary`): tarjeta con icono `sparkle` y viñetas generadas
   de los datos reales.
7. **«El negocio en gráficos»**: `DayPulse` (últimos 14 días, ver §3.4) · fila de **tres
   anillos de progreso** (`ProgressRing`: Mes con IPV, Margen neto del mes, Cuentas al
   día — anillo con % y texto explicativo al tocar) · `MonthHeatMap` compacto (mapa
   térmico del mes en curso, §3.5).
8. **«El día y su cierre»**: `DayTimeline` (eventos del día con/sin hora) y
   `NightCloseConsole` (pasos del cierre con botón de acción por paso).
9. Alerta **«Este mes va en rojo»** si el resultado acumulado es negativo (borde 2px
   `--danger`, con botones a Gastos y a Queen).
10. **Desglose de cuentas por categoría**, **Avisos del período**, **Pronóstico de
    ventas**, **Patrones que voy aprendiendo** (bloques condicionales según datos).
11. **Tarjetas de gráficos del período** (`ChartCard`, radio 22px, título `font-display`
    17px): «Ventas {por día/semana…}» → `BucketBarsChart`; «Ganancia (bruta y neta)» →
    `BucketNetChart`; «Venta por departamento» → `DeptVentaChart`; «Fondos del período»;
    «Gastos registrados del período» → `GastosDiaChart`. (Interactividad en §3.1–3.2.)
12. **Fondos económicos** (`EconomyMeters`): dos medidores — 10% de las ventas
    mensuales y 15% de las utilidades trimestrales — tarjeta radio 26px con cifra héroe
    Georgia, pastilla con el %, y **barra de avance del período** (16px, redonda) con
    «X días con IPV / N días al cierre».
13. Botón circular «+» (56px, `#0B7285`) al final → Importar.

> Nota: la tarjeta «DE UN VISTAZO» con anillo de salud **no** vive en Inicio: vive en
> Sistema (§2.4). En Inicio el equivalente visual es el conjunto 5–7.

### 2.2 Cobrar (`cobrar`)

- Cabecera `TabHeader` (icono `wallet`, chip «Dinero en la calle»).
- Fila de chips (tablist «Cobrar y clientes») con las vistas: **Cuentas · Clientes ·
  Comprobantes de pago · Entidades**; dentro de Cuentas, vistas **Todas pendientes /
  Morosas** (el título cambia a «Cuentas morosas»).
- Tarjeta de **leyenda de plazos** (clientes 7 días, trabajadores 15 días hábiles, casa
  siempre amarillo, pagadas azul) y ayuda ⓘ (`InfoHelp`) con las reglas.
- **Tarjetas de cuenta** (`account-swipe-card`, radio 16/24px): foto/color de acento por
  persona (borde interior izquierdo 3px del color de la cuenta), «Debe X de Y», marca de
  antigüedad que **envejece de verde claro a rojo** durante el plazo propio; morosa =
  borde `--danger`; pagada = azul. Interacciones: tocar la tarjeta abre su **cronología**
  (historial de abonos); **deslizar →** prepara el pago, **deslizar ←** detalles; panel
  de pago con fecha, selector cápsula Efectivo/Transferencia, pago parcial o total;
  edición en línea de la cuenta; último SMS de cobro con su hora.
- Vista **Clientes**: tarjetas de contacto con **solo el total que debe hoy** (si saldó,
  no aparece ningún monto).
- **Comprobantes de pago** y **Entidades** (servicios a instituciones, cobro bancario)
  como secciones propias con su título `font-display` 26px e icono en `#084C5C`.
- Botón propio «Añadir una cuenta» al final (`.fab-section`), no el «+» genérico.

### 2.3 Queen (`queen`)

No es una pantalla de tarjetas: es la **consola de la asistente** (se abre con
`openQueen()`; la pestaña no muestra el `TabHeader` estándar).

- Cabecera con el **orbe Reactor** en su etapa actual, título «Queen» `font-display` y
  estado de salud; botón de borrar historial.
- **Conversación** en burbujas: usuario `#0b7285`, Queen `#087a55` (oscuro `#0e7c93` /
  `#0f7d58`), texto blanco. Queen es 100% texto (sin voz ni micrófono). Sus respuestas
  con cifras llevan **línea de verificación** («Verificado contra: … · Sin verificar: …»).
- Panel **«Lo que estoy viendo»**: sugerencias/insights con el orbe en estado
  `suggestion`/`alert`.
- Panel **«Lo próximo»** (anticipaciones).
- Panel de **consultas y correcciones**: avisos registrados con detalle expandible y
  formularios de corrección (gastos, inventario) con confirmación.
- Panel **SMS de cobro**: bandeja de salida con pestañas por categoría y reenvíos a los
  7 días, siempre con confirmación previa.
- Panel **«Memoria de Queen»**: aprendizaje, directivas y permisos por modo visibles.
- **Preguntas rápidas**: popover con preguntas frecuentes.
- La etapa del Reactor también pinta la pantalla de arranque (marca de 84px en estado
  `thinking`) y el orbe de la navegación.

### 2.4 Sistema (`sistema`) — 16 tarjetas reordenables

Orden por defecto (`SISTEMA_CARDS`, App.tsx:14562). El dueño puede **reordenar las
tarjetas** (organizador con guardar en servidor y «Restablecer») y hay un **modo
ultraligero**. Primera tarjeta según lo aprobado: el perfil/evolución de Queen.

1. **Evolución de Queen** (`evolucion`): etapa del Reactor, estados y salud.
2. **De un vistazo** (`vistazo`) — la tarjeta de referencia del dueño (`.premium-panel`):
   kicker «DE UN VISTAZO» con punto vivo pulsante; **anillo de salud** (`.premium-ring`,
   92px, `conic-gradient` con `--ring-deg` = salud×3.6, color por tramo: ≥85 acento,
   ≥70 dorado, ≥50 `#e07b24`, <50 peligro) con la cifra y «salud»; texto «Todo bien» o
   «Hay N cosas que necesitan tu atención hoy»; «Comprobado a las HH:MM»; botón
   «¿Por qué este número?» que despliega la explicación y «Preguntar a Queen».
3. **Necesita tu atención hoy** (`atencion`, solo si hay avisos): lista de problemas en
   lenguaje llano; cada uno se expande con explicación, acción que navega a su pestaña
   y «Preguntar a Queen»; avisos reflejos con botón «Ignorar».
4. **El SDA como organismo** (`organismo`): centinelas/estado del organismo.
5. **Queen y red neuronal** (`queen`).
6. **Diagnóstico general** (`diagnostico`): incluye el **radar suave** (§3.6).
7. **ADN operativo** (`adn`).
8. **Sistema en tiempo real (gráficos)** (`tiempo-real`): `SystemRealtimeCharts` (§3.3).
9. **Rutinas y subrutinas de Queen** (`rutinas`).
10. **Monitor del sistema** (`monitor`): con `SystemSparkline` y reloj en vivo
    (`LiveClockCard`).
11. **Cómo se integra la información** (`integracion`): mapa de integración navegable.
12. **Accesos directos** (`accesos`).
13. **Simulación de escenarios críticos** (`simulacion`).
14. **Banco de errores · Sistema inmune** (`errores`): células por error verificado
    (firma, módulo, causa, anticuerpo, detecciones, neutralizaciones).
15. **Tareas y disciplina** (`tareas`): estados formales de tareas largas.
16. **Cierre técnico e inicio** (`cierre`): `StartupTimeline`, respaldos, salud de arranque.

Además en Sistema: tarjeta «Procedencia de las cuentas» dentro de un **plegable cerrado
por defecto**. Sistema es **solo salud/funcionamiento técnico**: nada de cifras de
negocio (eso vive en Inicio) y ningún gráfico de flujos/Sankey en todo el sistema.

### 2.5 Más (`mas`)

Rejilla de tarjetas-botón (1 columna móvil, 2 en md, 3 en lg; radio 22px, altura mínima
84px): insignia de 48px radio 16 con fondo `turquoise-soft` e icono en `#084C5C` (22px),
etiqueta 15px semibold, descripción 13px en `--dim`, chevron derecho. Son **todas las
pestañas menos Inicio/Cobrar/Queen/Sistema** (las 18 de la tabla del §1, en orden
alfabético). Al pie: «N días importados · Dinero en la calle: X CUP (solo cuentas de
clientes)». En escritorio este mismo inventario vive en la barra lateral.

### 2.6 Días (`dias`) — pestaña propia del original

1. **«IPV de hoy listo para llenar»**: tarjeta con icono `calendar` y botón de descarga
   (genera el IPV fresco del día desde el último original).
2. **Rejilla de cuadrados del mes** (`DiasMonthGrid`, §3.7): calendario L–D, intensidad
   por venta, marcador «Punta», leyenda; al tocar un día con IPV se abre **abajo** el
   detalle completo de ese día (el de siempre: departamentos, fondos, cuadre, RH,
   cuentas, con Editar / Descargar / Eliminar).
3. Lista de días agrupada por mes (del más reciente al más antiguo) y aviso de **huecos
   vencidos** (días sin importar, con fecha exacta).
4. La **misma rejilla** se reutiliza en **Historial** para los boletines: verde =
   enviado, ámbar = pendiente, punteado vacío = sin boletín; al tocar baja a la tarjeta
   del boletín (reintentar, regenerar, descargar, enviar otra copia).

### 2.7 Cuentas — en el original NO es pestaña separada

Las cuentas viven dentro de **Cobrar** (§2.2): las tarjetas por persona son tarjetas de
**cuenta** (con cronología, pago y deslizamiento), y la vista «Clientes» de Cobrar es la
que agrupa por contacto mostrando solo el total debido hoy. No existe una pantalla
«Cuentas» independiente en el original.

### 2.8 RH — cuadrados del mes por trabajador (`WorkerMonthSquares`)

En la ficha de cada trabajador: rejilla de calendario del mes natural (semanas L–D,
encabezado L M X J V S D), un cuadrado por día **solo con las marcas reales del IPV**:
lleno `--deep` = trabajó · medio tono `turquoise-soft` = medio día · gris
`surface-tonal` = descanso · **punteado** = aún sin foto · **«A» en ámbar** = ausencia
justificada (con motivo en el título) · **borde dorado** = hoy · futuros al 60%.
Pastilla con «N días trabajados» y leyenda escrita bajo la rejilla. No es interactiva
más allá del tooltip; los cuadrados de la quincena en la ficha siguen la misma clave.

---

## 3. Interactividad de los gráficos del original (condición expresa del dueño)

Todos los gráficos de negocio son **HTML/CSS/SVG nativos** (`charts.tsx`,
`futureCharts.tsx`): sin animaciones, con carga diferida por vista, y comparten un mismo
contrato de interacción:

- **Tocar = detalle.** Cada marca es un `<button>` real con `aria-label` completo
  («{etiqueta}: {valor} CUP»). Al tocarla queda seleccionada (`is-selected`) y **debajo**
  del gráfico aparece el panel de detalle (`.chart-selected-detail`, `aria-live=polite`)
  con título y líneas por serie (punto de color + etiqueta + cifra). Sin selección, el
  panel muestra la pista: **«Toca una barra para ver el detalle.»**
- **Leyenda** (`.lite-chart-legend`) solo cuando hay 2+ series: punto de color + nombre.
- **Sin datos** → `.chart-empty`: «Sin datos para representar en este período.» Nunca se
  dibuja un gráfico vacío ni con ceros inventados.

### 3.1 `ColumnChart` — columnas píldora (Ventas por día/tramo, Ganancia, Gastos por día, comparativas, nómina)

- Columnas como botones en rejilla `repeat(var(--chart-columns), minmax(0,1fr))` —
  **nunca desbordan** (`minmax(0,1fr)` + tarjeta con `overflow:hidden`).
- Barras con forma de píldora: `border-radius: 999px 999px 3px 3px`, altura mínima 3px,
  opacidad .9, una por serie con su color.
- **Línea de media estilo Samsung Health**: solo con **una serie y ≥3 marcas**. Línea
  discontinua (`border-top: 2px dashed`) a la altura exacta del promedio de los valores
  dibujados, con **pastilla «Media X»** a la derecha. Con dos series no se dibuja
  («la media sería de nadie»).
- **Modo denso** (`is-dense`) automático con **≥20 datos**: huecos de 2px/1px, etiquetas
  a 9px sin partir. Variante `angled` para etiquetas largas en comparativas.
- Altura de dibujo fija: 190px de barras + etiquetas (área total ≥230px).

### 3.2 `RowChart` — barras de niveles (Venta por departamento, Ganancia por producto)

- Filas tocables: nombre · barra · cifra compacta **+ % del total** (el % solo si todas
  las partes son ≥0 y el total es real).
- La barra lleva el **degradado verde→naranja** (`#2fbf71 → #a8c256 → #e9a13b`) recortado
  a la longitud de la fila (`backgroundSize` compensado: el color marca el valor absoluto,
  no el relativo a la fila).
- Al tocar: fila resaltada con `surface-tonal` y detalle bajo el gráfico.

### 3.3 `SystemRealtimeCharts` — gráficos de Sistema con 5 vistas conmutables

Selector de pestañas (`role=tablist`): **Salud · Actividad · Eventos · Rendimiento ·
Día × hora**. Cada vista:

- **Salud**: dona de estados de los componentes (Correcto/Verificando/Reparando/Error,
  colores `#23aa70/#d4a72c/#3182ce/#d84a4a`). La leyenda es **interactiva**: tocar un
  estado filtra/resalta ese estado en la dona (`aria-pressed`, toggle).
- **Actividad**: barras de avance % de las rutinas activas.
- **Eventos**: fallos registrados por día (barras anchas).
- **Rendimiento**: conmutador de métrica **Peso (KB) · Memoria (MB) · Latencia (ms)**;
  línea desde el 0 con lectura «N lecturas disponibles · eje desde 0 · {unidad}»; si una
  métrica no tiene dos lecturas reales, muestra el aviso en vez del gráfico.
- **Día × hora** (rejilla): filas = días, 24 columnas = horas; cada bloque es una hora
  con intensidad = nº de comprobaciones (escala de niveles con `hourLevelColor`).
  Encabezado con la **hora punta** («HH:00 — N lecturas el {día}») y marcador **«Punta»**
  sobre la columna de la hora máxima; eje 0/6/12/18/24 (h); **leyenda de niveles**;
  cada celda lleva `title` con día, hora y lecturas. Una hora sin lecturas queda en tono
  vacío: «no se rellena actividad que no se midió».

### 3.4 `DayPulse` — pulso de ventas (Inicio)

Últimos 14 días en barras tocables. Sin tocar: texto vivo con el último día, su delta
frente al anterior en CUP y % («+X CUP (+Y %) frente al día anterior»). Al tocar un día:
frase completa — venta del día, diferencia contra su día anterior («lo mismo que / X más
que / X menos que») y **el promedio de los días mostrados**. Todo calculado de los datos.

### 3.5 `MonthHeatMap` — mapa térmico del mes (Inicio; versión completa reutilizable)

Rejilla de calendario: cada día es un **botón** cuya intensidad «respira» según su venta;
tocar un día lo selecciona (toggle) y muestra su detalle; el día de hoy va marcado. Sin
IPV = sin intensidad (no cuenta como venta 0). En Inicio se usa en modo `compact`.

### 3.6 `DiagnosticRadar` — radar suave del diagnóstico (Sistema → Diagnóstico)

SVG 320×300: polígono **suave con relleno y puntos** por área puntuada (0–100). Las
áreas **sin verificar no entran** en el radar — pie de figura: «N áreas sin verificar no
entran en el radar: no se dibujan como cero». `aria-label` con la puntuación de cada área.

### 3.7 `DiasMonthGrid` — rejilla de cuadrados de Días (y de Historial)

- Calendario del mes (semanas que empiezan en lunes), un cuadrado por día (aspecto 1:1,
  radio 8px, número del día en 11px negrita).
- **Intensidad en 4 niveles** según la venta frente a la mejor del mes
  (`levelOf`/`levelColor`, escala de verdes del sistema): ≤¼, ≤½, ≤¾, la mayor.
  Nivel ≥3 → número en blanco.
- Día **sin IPV**: borde punteado, opacidad .7, sin relleno (ausencia, no cero).
- **Punta**: punto dorado en la esquina del mejor día + rótulo «Punta: {fecha} · {venta}
  CUP» con punto dorado en la cabecera de la tarjeta.
- **Hoy**: anillo dorado (`box-shadow 0 0 0 2px var(--gold)`). **Seleccionado**: doble
  anillo (`--surface` + `--deep`), `aria-pressed`, `active:scale-95`.
- `title`/`aria-label` por cuadrado: ventas, ganancia neta y cuadre («exacto» o importe).
- **Leyenda** bajo la rejilla: 4 niveles («Hasta ¼ / Hasta ½ / Hasta ¾ / La mayor de la
  mejor venta») + muestra «Sin IPV».
- Al tocar un cuadrado con IPV: se abre el detalle del día debajo (§2.6).

### 3.8 Otros componentes gráficos/de estado del original

- `ProgressRing` (Inicio): anillo SVG con % y, al tocar/expandir, el texto `detail`
  que explica el número con las cifras reales.
- `SystemSparkline` (Monitor): mini-línea Recharts (el único uso de Recharts, en chunk
  diferido), trazo `#45d6b0` por defecto, sin puntos ni animación.
- `CashBars` (río de caja) y `LuminousBars` (barras por categoría de gasto): viven en
  Economía/Inicio según vista; misma regla de detalle al tocar vía `FutureCard`.
- `NightCloseConsole` / `DayTimeline` / `StartupTimeline`: listas de pasos/eventos con
  estado real y botón de acción por paso (no son gráficos, pero forman parte de la
  superficie «gráfica» de Inicio/Sistema).
- Animaciones: **todas se pausan con la app en segundo plano**; `prefers-reduced-motion`
  las apaga; nada de desenfoque pesado (A16).

---

## 4. Inventario del EXTERNO (estado actual, `~/workspace/queen-sda-app/src/`)

- **Tokens** (`index.css`): subconjunto de la paleta (`--bg`, `--surface`,
  `--surface-2`, `--ink`, `--ink-soft`, `--line` rgba, `--accent`, `--accent-2`,
  `--gold`, `--danger`, `--paid`); aurora aproximada con 4 manchas y opacidades
  distintas; radio de tarjeta 26px (22px ≤640px); Georgia en `h1/h2/h3/.serif` y
  cifras (`.big-figure`, `.figure`, `.stat .value`, `table.kv`).
- **Navegación** (`App.tsx`): barra inferior plana de 5 con **iconos emoji** —
  Inicio `🏠` · Cobrar `💳` · Queen `👸` · Sistema `🩺` · Más `☰` — pegada a los bordes
  (`left/right/bottom: 0`), sin radio ni sombra, activa = solo color acento. Lateral
  ≥900px (218px, no fija de 288 ni con perfil/logo/grupos) con 7 destinos (incluye
  Días `📅` y Cuentas `🧾`). Cabecera superior con logo, nombre de usuario, rol y
  «Salir». **No hay `TabHeader` por pestaña**: cada pantalla abre con un `h1` suelto
  (`.section-title`).
- **Inicio** (`screens/Inicio.tsx`): «De un vistazo» como eyebrow dentro de una tarjeta
  con rango de fechas + 6 stats (Ventas, Bruta, Neta, Dinero en la calle, Vencidas,
  Último día); `PillBars` de ventas por día; `LevelRow` por departamento; tarjeta de
  quincena contable (dos stats). Sin selector de período, sin comparativa, sin acciones
  rápidas, sin DayPulse/anillos/mapa térmico, sin tarjetas de ganancia ni fondos.
- **Sistema** (`screens/Sistema.tsx`): 3–4 tarjetas — estado de conexión (tabla kv),
  Importar respaldo, Perfiles de acceso, Datos en el servidor/locales. Sin anillo de
  salud, sin atención, sin evolución, sin gráficos en tiempo real, sin las 16 tarjetas.
- **Queen** (`screens/Secciones.tsx`): estado vacío honesto («Queen llega en la
  siguiente fase»). **Más**: dos listas (funcionando / siguiente fase), sin rejilla de
  tarjetas con insignias.
- **Días** (`screens/Dias.tsx`): rejilla simple 7 columnas de **solo días importados**
  (celda con número, valor y «Punta» en texto en la mejor), detalle del día al tocar.
- **Cuentas** (`screens/Cuentas.tsx`): pantalla propia con tarjetas por persona
  (chips de categoría/conteo/morosa, detalle expandible con filas de cuentas y chips
  Pagada/Morosa/Pendiente con vencimiento) y barra de antigüedad con degradado.
- **Cobrar** (`screens/Cobrar.tsx`): listado + formulario «Registrar un abono».
- **Gráficos** (`components/ui.tsx`): `PillBars` — barras con degradado turquesa→esmeralda,
  línea de media **dorada discontinua** con etiqueta «Media X», **sin interacción**
  (solo `title` del navegador, `role=img`); `LevelRow` — barra con degradado
  acento→dorado y % fuera (en el `display`), **sin toque ni detalle**.
- **Iconos PWA**: `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `icon.svg` (marca Reactor simplificada); logo de cabecera = el icono PWA.

---

## 5. (b) Brechas externo → original, por impacto visual

### Globales (afectan a todas las pantallas)

1. **Iconos emoji → sistema SVG propio.** Es la brecha más visible: el externo usa
   🏠 💳 👸 🩺 ☰ 📅 🧾; el original no usa **ningún** emoji en la UI. Crear el
   componente `Icon` con los 36 paths SVG (stroke 1.8) y sustituir todos los iconos,
   incluida la navegación y los estados vacíos (📭 🌿 también sobran).
   → `src/components/ui.tsx` (nuevo `Icon`), `src/App.tsx`, `src/screens/*.tsx`,
   `src/index.css`.
2. **Barra inferior: pastilla flotante, no barra plana.** Radio 30px, márgenes 12px,
   sombra suave, fondo aurora (`.ambient-bar-surface`), cápsula `turquoise-soft` +
   texto `#084C5C` en la activa, puntos ambientales de estado y badges numéricos.
   → `src/App.tsx` (NAV), `src/index.css` (`.bottomnav`).
3. **Queen en la navegación = orbe Reactor, no 👸.** Marca SVG por etapa con sus
   colores (Joven `#F0564F` como etapa actual registrada) y estados; también en la
   lateral (27px), la cabecera de Queen y el arranque. Sin cápsula ni aro alrededor.
   → nuevo `src/components/QueenReactor.tsx` (port de `QueenReactorMark`/`QueenOrb`),
   `src/App.tsx`, `public/icons/` (PWA: hoy el icono es una simplificación).
4. **Falta el `TabHeader` en todas las pestañas** (insignia 26px + título Georgia +
   descripción + chip distintivo, tarjeta con degradado turquesa-suave). Hoy cada
   pantalla abre con un `h1` pelado. → `src/components/ui.tsx` (nuevo `TabHeader`),
   todas las `src/screens/`.
5. **Tokens incompletos y renombrados.** Añadir los que faltan con los nombres/valores
   del original: `--surface-alt`, `--surface-tonal`, `--turquoise`,
   `--turquoise-soft`, `--text` (=`--ink`), `--dim`, `--border` (hoy `--line` rgba),
   `--deep`, `--deep-2`, `--on-accent`, `--danger-soft`, `--warn-soft`, `--paid-*`,
   `--card-shadow`, `--card-radius*`, escala tipográfica y colores `--chart-*`.
   En oscuro faltan `--turquoise #2dd4ee`, `--danger #ff8a80`, superficies `#1c2f27`, etc.
   → `src/index.css`.
6. **Aurora distinta.** Igualar la receta de 6 manchas con posiciones/opacidades
   exactas y el degradado lineal base, en claro y oscuro; aplicar `.ambient-bar-surface`
   a barras fijas (hoy la cabecera usa `color-mix` plano y la inferior superficie
   semitransparente). → `src/index.css`.
7. **Barra lateral ≠ original.** La del original: fija 288px con logo 48px, fila de
   perfil que lleva a Ajustes, grupos «Principal»/«Más secciones» (orden alfabético),
   badges; la externa es una columna simple de 218px ≥900px (el original conmuta en xl).
   → `src/App.tsx`, `src/index.css` (`.sidenav`, `.layout`).
8. **Botones y tarjetas:** primario debe ser `--deep` (hoy acento), sin la sombra que
   hoy no existe pero con la `--card-shadow` oficial en tarjetas (hoy sin sombra y con
   borde rgba propio). Radio compacto 22px ligado a la clase compacta, no a un corte de
   640px genérico. → `src/index.css`.

### Inicio

9. **Estructura completa distinta.** Faltan, en orden: selector de período con
   quincena-cerrada, línea de cobertura, PDF/PowerPoint, «Este mes vs el anterior»,
   acciones rápidas, «Resumen de hoy». → `src/screens/Inicio.tsx`.
10. **«De un vistazo» degradado a eyebrow.** En el sistema del dueño esa tarjeta es la
    de Sistema con anillo de salud; en Inicio lo equivalente es el bloque de gráficos
    (n.º 11). El eyebrow actual con 6 stats no existe como tal en el original.
    → `src/screens/Inicio.tsx`.
11. **Faltan los gráficos insignia de Inicio:** `DayPulse` (14 días con frase al
    tocar), los **tres anillos** de progreso con explicación, y el **mapa térmico del
    mes** compacto. → nuevos componentes en `src/components/` + `src/screens/Inicio.tsx`.
12. **«Ventas por día» sin interactividad ni contrato Samsung:** el `PillBars` externo
    no se puede tocar, no tiene panel de detalle, la media va en dorado (original:
    discontinua en `--dim` con pastilla «Media X» en superficie) y no tiene modo denso
    ≥20 ni píldora `999px 999px 3px 3px` con colores `--chart-*`. Portar `ColumnChart`.
    → `src/components/ui.tsx` → nuevo `src/components/charts.tsx`, `src/index.css`.
13. **Departamentos:** el original es `RowChart` tocable con % del total y degradado
    verde→naranja anclado al valor absoluto; el externo (`LevelRow`) usa degradado
    acento→dorado relativo y no responde al toque. → `src/components/charts.tsx`.
14. **Faltan tarjetas:** «Ganancia (bruta y neta)» de dos series con leyenda, «Fondos
    del período», «Gastos registrados del período» y los **medidores de fondos**
    (10%/15%) con barra de avance y cifra héroe. La «Quincena contable» actual como dos
    stats sueltos no existe así en el original. → `src/screens/Inicio.tsx`.

### Sistema (la brecha más grande de contenido)

15. **De 3 tarjetas administrativas a consola de 16.** Faltan las 16 tarjetas
    reordenables del §2.4 — empezando por **Evolución de Queen** y **«De un vistazo»
    con el anillo de salud** (`.premium-ring` cónico 92px + kicker con punto vivo),
    «Necesita tu atención hoy», organismo, diagnóstico con **radar**, ADN, **gráficos
    en tiempo real de 5 vistas** (incl. rejilla día×hora), rutinas, monitor con
    sparkline y reloj, integración, accesos, simulación, banco de errores/inmune,
    tareas y disciplina, cierre técnico — y el organizador de tarjetas + modo
    ultraligero + plegable «Procedencia de las cuentas». Y sin meter cifras de negocio.
    → `src/screens/Sistema.tsx` (reescritura), componentes nuevos en `src/components/`.

### Gráficos e interactividad (transversal)

16. **Sin panel de detalle al tocar en ningún gráfico** (el contrato central del
    original: tocar → `is-selected` + detalle `aria-live` debajo + pista «Toca una
    barra…»). → `src/components/charts.tsx`, `src/index.css` (`.chart-selected-*`,
    `.chart-hint`, `.lite-chart-*`).
17. **Sin modo denso, sin leyendas de series, sin etiquetas accesibles completas** en
    columnas. → `src/components/charts.tsx`.
18. **Rejilla día×hora inexistente** (Sistema) y **radar inexistente** (Diagnóstico).
    → `src/components/charts.tsx` / componentes de Sistema.
19. **Cuadrados de RH inexistentes** (el externo aún no tiene RH): cuando llegue,
    deben ser los del §2.8 con su clave de color exacta — no una rejilla genérica.
    → futuro `src/screens/RH.tsx`.

### Días

20. **Rejilla incompleta:** el original pinta **el mes entero** (vacíos iniciales,
    días sin IPV punteados, intensidad en 4 niveles con leyenda escrita, anillo dorado
    en hoy, doble anillo en seleccionado, punto «Punta» en la esquina y rótulo con la
    mejor venta). La externa solo pinta días importados en celdas planas con «Punta»
    en texto y contorno dorado. Faltan además la tarjeta «IPV de hoy listo para
    llenar», el aviso de huecos y la lista agrupada por mes. → `src/screens/Dias.tsx`,
    `src/index.css` (`.day-grid/.day-cell`).

### Cobrar / Cuentas

21. **Cuentas como pantalla propia no existe en el original:** vive dentro de Cobrar
    con vistas por chips (Cuentas/Clientes/Comprobantes/Entidades) y Morosas. La
    navegación externa debería replantearse a ese modelo. → `src/App.tsx` (NAV/SIDE),
    `src/screens/Cobrar.tsx`, `src/screens/Cuentas.tsx` (integrar como vista).
22. **Tarjetas de cuenta sin el lenguaje del original:** faltan color de acento por
    persona con borde interior, envejecimiento verde→rojo por plazo propio, gesto de
    deslizar (→ pago / ← detalles), cronología al tocar, panel de pago con selector
    cápsula Efectivo/Transferencia y SMS. Los chips y la barra de antigüedad actuales
    son una aproximación distinta. → `src/screens/Cobrar.tsx`, `src/index.css`.
23. **Vista Clientes:** el original muestra en la tarjeta de contacto **solo el total
    debido hoy** (nada si saldó); la externa mezcla conteos y chips en la tarjeta de
    persona. → `src/screens/Cuentas.tsx`/`Cobrar.tsx`.

### Queen y Más

24. **Queen vacía vs consola completa:** chat con burbujas de color oficial, orbe por
    etapa, paneles «Lo que estoy viendo» / «Lo próximo» / correcciones / SMS /
    memoria, preguntas rápidas y línea de verificación en respuestas con cifras.
    (Es fase funcional además de visual.) → `src/screens/Secciones.tsx` →
    `src/screens/Queen.tsx`.
25. **Más sin rejilla de secciones:** el original es la rejilla de tarjetas con
    insignia turquesa, descripción y chevron de **todas** las secciones (con su pie de
    días/dinero en la calle); la externa lista 2 accesos y 7 «siguiente fase».
    → `src/screens/Secciones.tsx`, `src/index.css`.

---

## 6. (c) Qué NO se pudo extraer y por qué

1. **Los informes del 22-oct** (`referencia-interfaz-queen-sda.md` e
   `informe-funcionamiento-sistema-queen-sda.md`): son enlaces simbólicos cuyo destino,
   `~/workspace/goals/panorama-mensual-la-reina/files/`, está **vacío** en disco
   (comprobado con `ls` y `readlink -f`). No hay otra copia en `~/workspace`. La
   especificación se construyó solo del código fuente del artefacto, que sí existe
   íntegro en `~/workspace/ts-spaces/panorama-mensual-la-reina/client/src/`.
2. **El aspecto renderizado final** (capturas píxel a píxel): el código define clases y
   valores, pero no se ejecutó ninguna de las dos apps para comparar capturas; esta
   especificación es de código, no de render. La confirmación visual sigue siendo,
   como siempre, el ojo del dueño en su teléfono.
3. **Detalles menores no leídos línea a línea** por tamaño (App.tsx tiene 26.688
   líneas): el contenido exacto de la cabecera superior móvil del original (existe —
   cierra en ~App.tsx:2701 — pero no se transcribió su interior), los textos completos
   de cada una de las 16 tarjetas de Sistema más allá de su orden y función (sí se
   extrajeron «De un vistazo», atención y el radar), y el interior de pestañas fuera
   del encargo (Economía, Elaboración, Productos, etc., inventariadas solo por
   etiqueta/icono/chip en §1–§2.0).
4. **La etapa «celula» del Reactor** no tiene color en `QUEEN_REACTOR_STAGES`
   (solo infante/juvenil/adulto/maduro lo definen); su render usa el camino por defecto
   del SVG. Se registra tal cual: no se inventó un color para ella.
5. **Datos de negocio:** ninguno — por regla del encargo, este informe es solo diseño;
   las cifras que aparecen son constantes de diseño del propio código (p. ej. los
   porcentajes de los medidores de fondos).

---

*Generado el 2026-10-25 desde el código fuente de ambas apps. Sin modificar código de
ninguna de las dos: solo lectura y este entregable.*

---

## 7. Fase media + ficha completa (2026-10-26): lo que esta fase cierra

Con la tabla `public.media` (167 filas cargadas por SQL) y el estado
extendido de `app_settings` ya en Supabase, esta fase CONECTA todo
en la app. Cliente nuevo `src/lib/media.ts`: índice ligero por kind
bajo demanda (sin `data_base64`) y binario por
(kind, entity_key, variant) bajo demanda con caché en memoria →
data URL; nunca se trae la tabla entera (rendimiento A16). El
`slug()` es idéntico al del generador de la carga (NFD, sin
diacríticos, `[^a-z0-9]+` → `-`).

**Por pantalla:**

- **Productos:** foto de cada producto (`foto-producto` por
  slug(dept+nombre+um), la clave de `productKeyOf`) en la cabecera
  de la tarjeta y en grande en el detalle. Sin fila en media, la
  tarjeta va sin foto: ausencia, nunca imagen inventada.
- **Elaboración:** la misma foto en la rejilla de productos (con la
  letra de respaldo de antes) y en Barra · ml.
- **Almacén:** foto del producto (`foto-almacen` por slug del
  nombre) en existencias y en movimientos.
- **RH:** foto del trabajador (`foto-trabajador` por slug del
  nombre; sin foto, iniciales) en el organigrama, en la lista y en
  la ficha. La ficha y el organigrama leen `workers-extended`
  (emparejado por worker_key/nombre normalizado) con la precedencia
  del original: turno válido = corrección → detectado del IPV →
  puesto a mano (la ficha declara la fuente); estrellas pintadas
  si > 0 (organigrama, lista y ficha); días fijos y día de descanso
  visibles en la ficha; contrato cancelado con banda roja
  «CANCELADO» y su fecha (Yeisi, 2026-10-17). El texto del
  organigrama quedó corregido: el turno a mano y las estrellas YA
  viajan por esta vía.
- **Cobrar/Cuentas:** foto del cliente (`foto-cliente`, coincidencia
  por slug completo y, si no, por primer nombre) en la tarjeta de
  cuenta y en los grupos; sin foto, el avatar de iniciales de siempre.
- **Perfil:** la foto `foto-perfil` (perfil-admin) en el perfil
  lateral de la app y en el avatar del usuario en la consola de
  Queen; sin foto, las iniciales.
- **Documentos:** el cuño APROBADO real (`activo-sistema` ·
  cuno-la-reina-aprobado) se incrusta en el bloque de certificación
  al abrir la nómina y el informe, sustituyendo el texto «Cuño no
  disponible en este dispositivo.»; tarjeta «Firmas y cuño» con la
  vista previa del cuño y del logotipo. Las firmas personales
  siguen marcadas «Firma autorizada pendiente» en el documento:
  el trazo de cada persona vive en su ficha de RH y el bloque de
  documentos no lo sustituye por su cuenta. El menú sigue EXCLUIDO
  de firma y cuño (regla del dueño), intacto.
- **Sistema · Evolución:** el panel muestra el HISTORIAL REAL del
  servidor (`app_settings` · `queen-evolution-history`: Infante
  40.4 → Joven 50.0, con fecha y motivo), que MANDA sobre el
  snapshot local de esta copia; la procedencia queda declarada en
  el propio panel.
- **Días e Historial:** botones de descarga del IPV original y del
  actualizado de cada fecha desde la media (`ipv-original` /
  `ipv-actualizado`), solo cuando el archivo existe para esa fecha,
  como el historial de versiones del original. El resumen del día
  en texto se mantiene como estaba.

**Ficha completa (RH), puerto del original:**

- **Lienzo de firma:** firma con dedo o lápiz óptico (presión si
  hay lápiz, rechazo de palma, eventos coalescidos, como el
  SignaturePad del original), con su texto «Firma con el lápiz
  óptico o con el dedo…», borrar y guardar. Solo el administrador
  firma/guarda/borra; la firma se guarda en media
  (`firma-trabajador`, PNG) y, si existe, se muestra en la ficha y
  en la credencial. Hoy NO existe ninguna firma (en el original
  `signature_data` viene vacío en las 25 fichas): la ficha parte
  sin firma, como en el original.
- **Credencial digital:** tarjeta 638/1011 con los dibujos y
  posiciones del original, foto, logotipo blanco, nombre, cargo,
  identificador `LR-TRAB-…` del id real del trabajador y QR
  generado con la librería `qrcode`. Botones «Mostrar credencial
  digital» (pantalla completa) y «Descargar credencial en PDF»;
  si falta foto, ocupación, carné o firma, el aviso del original:
  «Completa … para generar la credencial final».
- **Escáner de credenciales:** sección en RH que lee el QR con la
  cámara (`jsqr` + getUserMedia), con respaldo por foto y por
  entrada manual del código; al leerlo abre la ficha de la persona.
- **Documentos del trabajador:** carnet (frente y reverso), tarjeta
  bancaria, título y documentos extra, en media
  (`documento-trabajador` con su variant): los 4 documentos reales
  de Yadir Medina Oliva se ven desde la carga inicial; visor de
  imagen o PDF; subir/reemplazar/eliminar solo administrador.

**Librerías:** `qrcode` y `jsqr` instaladas y cargadas SOLO como
import dinámico perezoso (trozos separados del paquete: ~26 KB y
~131 KB; el arranque no paga su peso), como el original.

**Desviaciones honestas de esta fase:**

1. **Firma guardada como imagen, no como trazos:** el original
   guarda la firma como JSON de trazos vectoriales
   (`signature_data`); en esta copia se guarda el PNG rasterizado
   del lienzo en la tabla media (es el contrato fijado para el
   clon). La firma se ve igual en ficha y credencial; no se puede
   re-dibujar trazo a trazo.
2. **Identificador derivado solo cuando falta el real:** el id de
   credencial sale del id real del estado extendido; para un
   trabajador sin registro extendido se deriva un número estable
   de su clave (900000 + hash) para que la credencial no quede sin
   identificador. No sustituye a ningún id real.
3. **PDF de la credencial:** se genera desde la propia tarjeta
   (ventana de impresión con la tarjeta reconstruida en HTML y el
   QR dibujado desde su matriz), no con el generador de PDF del
   servidor del original.
4. **Sin extracción automática de documentos:** la verificación
   del carnet del original extrae los datos en su servidor
   (`document_extracts`); esta copia muestra los datos de la ficha
   frente al documento y declara «sin extracción automática en
   esta copia». No se simula ninguna extracción.
5. **Fotos de producto y nombres de catálogo:** la coincidencia
   es exacta por slug(dept+nombre+um). Algunos archivos cargados
   traen el nombre de otra época (p. ej. el stem de «ron black
   tears», o «vino-titnto» con errata): esos productos se quedan
   sin foto hasta que el nombre coincida; no se hace coincidencia
   difusa para no enseñar la foto de otro producto.
6. **Modo local:** sin Supabase configurado, la media queda vacía
   y mandan los respaldos (iniciales, textos de ausencia): la app
   no inventa binarios.

---

# CIERRE — COPIA INTEGRAL POR INVENTARIO CERRADO (26-oct, coordinación)

## La foto de datos es el estado ACTUAL del original
La carga de esta copia NO es el respaldo del 24-oct: es la foto extraída del servidor original el 26-oct (acción `exportdata`), guardada como `backup-sda-2026-10-26.json` (24 días, 1→24-oct). Sus totales se verificaron contra los resúmenes que calcula el propio servidor (`getcoresnapshot`): **24 días · ventas 2.786.190 · bruta 718.191 · neta 696.096 · cuadre 0 · 119 cuentas · 51 gastos · 25 trabajadores · nóminas 95.000 y 86.500** — coincidencia exacta por dos vías independientes. El SQL de carga es `supabase/import-backup-2026-10-26.sql` (generado con los totales de control de ESTA foto; `verify:import` pasa contra ambos respaldos). El del 24-oct queda como referencia de contraste y regresión.

## Orden de carga en un proyecto Supabase (tras el login del dueño)
1. `supabase/schema.sql` (incluye la tabla `media` con RLS).
2. `supabase/import-backup-2026-10-26.sql` (los datos de la foto actual).
3. `supabase/media-import.sql` (167 binarios reales; SOLO por la vía autenticada — nunca archivos estáticos).
4. `supabase/workers-extended-import.sql` (turnos asignados, estrellas, contrato cancelado, historial real de evolución de Queen).
5. `supabase/modulos-extended-import.sql` (almacén manual, inventario de bienes, versiones de IPV).

## Qué cerró esta fase (todo verificado, batería entera en verde)
- Organigrama-flujo de RH (con turno válido = corrección → detectado → asignado, estrellas y fotos reales).
- Panel completo de evolución de Queen en Sistema + historial real del servidor (Infante 40,4 → Joven 50,0).
- **Sistema inmune en vivo** dentro del Banco de errores (campo animado del original, alimentado del banco real del clon; 16 checks nuevos en verify:paridad, que ya suma 72).
- Media real tras el login: 35 fotos de producto, 5 de almacén, 18 de trabajadores, 4 de clientes, 4 documentos (de Yadir: carnet frente/reverso, tarjeta bancaria, título), foto de perfil, cuño y logos, 22 archivos IPV y 74 adjuntos/gráficos de boletines. **Firmas: no existe ninguna guardada en el original** (verificado en su BD: `signature_data` vacío en las 25 fichas, sin formularios ni contratos guardados) — el lienzo de firma está portado y parte vacío, como en el original.
- Ficha completa: firma, credencial 638/1011 con QR real, escáner de credenciales, documentos con subida/visor.
- Almacén manual (19 movimientos reales, existencias calculadas) e Inventario de bienes (219 reales) con persistencia admin en app_settings.
- Fuga del respaldo cerrada: receivablePhotos, smsLogs, smsOutbox, monthlyArchives y workerPayments viajan íntegros de ida y vuelta (contenido idéntico verificado).
- Service worker v3: red primero para JS/CSS/HTML; cada despliegue se aplica al abrir.
- Inventario cerrado: **995 líneas — PRESENTE 225 · PARCIAL 198 · AUSENTE 572**, con `npm run verify:inventario` recorriéndolo entero y fallando si código e inventario se separan.

## Lo que sigue sin viajar (declarado, nunca simulado)
El inventario línea a línea es la lista completa; en síntesis queda fuera lo que vive SOLO como inteligencia del servidor del original y no como pantalla o dato exportable: la memoria interna de Queen en su servidor (decisiones, predicciones, lecciones, conversación persistida, auditoría y disciplina automáticas), el sistema inmune DE SERVIDOR (el campo en vivo SÍ está; la intervención automática sigue diferida con las funciones en la nube que el dueño aplazó), el motor offline con IndexedDB del original (el clon es PWA con service worker propio), las herramientas internas de desarrollo (QA, corrector ortográfico interno, banco de tests), los constructores XLSX del IPV de vuelta (ipvRoundTrip: el clon descarga los XLSX reales guardados, no los regenera), la extracción automática de documentos por OCR del servidor, y los CRUD completos de módulos secundarios que el original tiene y esta copia cubre en lectura (Entradas, Extras/Entidades, Existencias como libro, Cronología global, Ajustes propios con PIN/biometría — sustituidos por la capa de acceso Supabase, la única diferencia admitida). Siete IPV originales del 14–17 oct están referenciados en el original pero sus archivos ya no existen ni en su propio almacén: no hay nada que copiar.

## Auditoría visual sintética — EJECUTADA (26-oct, harness reconstruido)

La auditoría que el paquete espejo anterior corrió sin guardar el harness quedó reconstruida y guardada en el repo: `scripts/audit-visual.mjs` (comando `npm run audit:visual`; requiere playwright-core y un Chromium headless — si falta, lo dice y no simula nada). Corre de verdad, no por análisis estático: Chromium 156 headless (caché de Playwright de la VM), la app en **modo local** (build propio con Supabase vacío cuyo CSS salió **byte-idéntico al de dist/**, comprobado por hash en la propia corrida) sembrada por la vía real de la app — login local → cambio de contraseña → «Importar respaldo del SDA» — con la foto fresca `backup-sda-2026-10-26.json` (24 días, 1–24 oct, en las 4 combinaciones de contexto).

**Alcance:** las 17 vistas de la app (las 15 de la matriz original más «cuentas» y «mas») × claro/oscuro × 360 px (Galaxy A16) y 1280 px = **68 combinaciones, todas renderizando, 0 errores JS**. Informe completo y capturas en `audits/audit-2026-10-26/` (report.json + 68 capturas + 4 del campo inmune).

**Resultado final: 0 defectos duros.** Sin un solo desborde horizontal de página ni elementos fuera del viewport en ninguna combinación. La corrida inicial encontró 3 defectos reales, corregidos solo en CSS/presentación (sin tocar datos, cifras ni lógica), tras lo cual se reconstruyó y la auditoría se repitió entera:

1. **Inicio a 360 px desbordaba a 590 px**: la tarjeta de la Línea de tiempo es ítem de la rejilla «El día y su cierre» y su tamaño mínimo automático (la cinta de 540 px) la estiraba. `min-width: 0` en `.hm-future-card` y su carril: la tarjeta encoge y la cinta se desplaza dentro de su carril, como pide su propio texto. Verificado en captura: tarjeta a 328 px, cinta desplazable.
2. **Elaboración a 360 px con las pestañas ilegibles** («Pro…/Re…»): al portar las pestañas se habían quedado fuera los bloques responsive del theme.css original. Portados tal cual (`sectionsMirror.css`): `@media (min-width: 1100px)`, `@media (max-width: 680px)` (principales a 3 columnas, área a 2, rejilla de productos a 1) y `@media (max-width: 390px)` completos. Las de área se leen enteras («Todas 66 · Cocina 44 · Pizzas 2 · Coctelería 20»); en las principales aún se eliden «Rentabilidad» y «Paquetes y rendimientos» a 360 px — con las mismas cuentas de ancho que en el original en ese dispositivo (rejilla de 3, fuente 11 px, contador de 20 px): paridad, no recorte añadido.
3. **Gráficos en oscuro con los colores de día**: el bloque oscuro no redefinía las 8 series `--chart-*`. Añadidas con los valores del bloque oscuro del original (#42d392, #a7d7bc, #42cfe3, #81968a, #78b898, #62ddb0, #a1b5a9, #3fb582).

**Paridad de tokens (check estático sobre el CSS entregado):** 45 tokens en claro, 31 redefinidos en oscuro, **0 tokens de color sin redefinir**; heredan el claro solo `--accent-ink`, `--gold` y `--on-accent`, que el bloque oscuro del propio original tampoco redefine (acentos constantes). Reglas de ancho: max-width en 350/380/390/420/430 (banda ≤360 cubierta) y min-width de 700 a 1100 (banda tablet cubierta). Ninguna animación con `transform` aplicada a contenedores de página (las de entrada son solo opacidad). `--card-shadow` sí se redefine en oscuro.

**Sistema inmune en vivo (criterios de la skill, verificados en runtime y en fuente):** fondo sólido en ambos temas (pintado en el propio canvas: #e9f3ee / #0a1e26) con bandas alternas por carril; células con cuerpo saturado, borde definido y núcleo (135–154 colores distintos por frame; píxeles no-fondo 12–49 %); rótulos de carril y etiquetas de anomalía sobre píldoras sólidas; **nada flota sobre el campo** — chips, barra de amenaza, leyenda y registro viven en `.immune-info` bajo el lienzo (comprobado en el DOM de las 4 combinaciones); el toque sobre una célula abre su tarjeta con datos reales (abierta en 7 de 8 contextos entre las dos corridas completas; el toque es sensible a la posición porque las células se mueven). Revisión visual de las capturas del campo en claro y oscuro: legible a brillo real, sin disolverse en degradado.

**Candidatos revisados a mano y clasificados «por diseño» (sin tocar):** elipsis del subtítulo de marca en la barra superior a 360 px (regla explícita `nowrap + ellipsis`; el texto completo vive en la barra lateral y en el acceso), etiqueta accesible de Queen de 1 px (oculta a propósito), nombres del organigrama con elipsis (la misma regla del original), etiquetas anguladas de los gráficos ligeros (rotadas) y el desborde interno de los SVG de los mapas de Sistema (recortado decorativo; etiquetas legibles en captura a 360 y 1280, en claro y oscuro).

---

# OLEADA 3 — LAS 6 SECCIONES DE «MÁS» CONECTADAS (26-oct, a orden del dueño)

El dueño encontró las tarjetas de «Más» que mostraban «Siguiente fase» y ordenó conectarlas ANTES de subir el zip. Hecho: **las 19 tarjetas de la rejilla abren una pantalla real**; la etiqueta «Siguiente fase» ya no existe en el código (check en verify:paridad). Cada pantalla espeja la del original con los datos que de verdad viajan en la foto fresca del 26-oct:

- **Entradas** (`src/screens/Entradas.tsx`, EntradasTab): KPIs del mes, inversión por departamento con barras, filtro por departamento, buscador y detalle agrupado por fecha desde `DayData.entriesDetail` (139 registros · 1.841.620 en la foto). Declarado en pantalla: las fotos de factura de entradas viven como blob en el servidor del original y no viajan; el PDF de factura tampoco se genera en esta copia.
- **Otros ingresos** (`src/screens/Extras.tsx`, ExtrasTab): lectura espejo del ExtrasTab — total del mes, las 4 categorías del original (Coctelería, Pizzería, Entrada, Mesas) con su misma heurística de clasificación y todos los registros, desde `DayData.extras` (2 registros · 8.500 en la foto, cuadrados contra Economía y el boletín). Sin CRUD: la tabla de registro manual del original no existe en el clon y no se simula; declarado en pantalla.
- **Existencias** (`src/screens/Existencias.tsx`, ExistenciasTab): destino propio con el MISMO `buildInventoryBook` de Productos (sin duplicar lógica): descuadres primero, buscador, lista por departamento y cadena por día del producto elegido. Declarado: los ajustes manuales del libro (rebajas/traslados/saldo inicial a mano) se guardan en el servidor del original y no viajan; aquí no se registran.
- **Archivo** (`src/screens/Archivo.tsx`): meses desde `StoredData.monthlyArchives` ÍNTEGRO (con consumo de la casa y resultado efectivo tal como los calculó el original), detalle del mes derivado de los registros reales (días, gastos, cuentas pagadas/nacidas, boletines) y la sección «Lo que NO se archiva ni se reinicia» con sus tres tarjetas vivas. Declarado: archivar un mes es acción del servidor del original — la copia muestra el estado del respaldo y no lo cambia; los PDF/facturas del mes no se generan (constructor no portado).
- **Cronología** (`src/screens/Cronologia.tsx`): CRONO_CATS (ipv, rh, cuentas, gastos, productos, boletines) con filtros, buscador, despliegue y salto a la sección de origen. Cada evento se DERIVA de un registro real: días, nóminas, pagos fuera de nómina, contrato cancelado, cuentas/abonos (del respaldo y locales)/saldadas, SMS de cobro enviados, gastos, cambios de precio y de costo detectados por el catálogo y boletines. El historial interno por trabajador del registro de RH del original no viaja y no se reconstruye.
- **Ajustes** (`src/screens/Ajustes.tsx`, AjustesTab): perfiles y roles reales de la capa del clon, ancla de ciclos de RH editable por el administrador con la misma vía que RH (local y Supabase), destinatarios fijos del boletín con enlace a Historial, enlaces a Documentos/Sistema (sin duplicar pantallas) y restablecer datos locales en modo local. Declarado en pantalla: el PIN y la biometría del original no existen en esta copia — los sustituye la capa de acceso, la única diferencia admitida — y el perfil se consulta, no se edita.

**Inventario tras la oleada 3** (recuento mecánico, `npm run verify:inventario` en verde): **995 líneas — PRESENTE 236 · PARCIAL 200 · AUSENTE 559**. De las líneas tocadas por esta oleada: 11 pasaron de AUSENTE a PRESENTE (las 6 pestañas, las pantallas de Extras/Entradas/Existencias, «Lo que NO se archiva» y el detalle del mes) y 3 de AUSENTE a PARCIAL (pantalla Archivo como lectura local, Cronología y pantalla Ajustes). Lo que sigue AUSENTE en estos módulos queda con su causa escrita en su fila: acciones de servidor (archivar mes, CRUD de extras, facturas y sus PDF, ajustes de inventario, edición de perfil, bandeja de correo del original).

**Verificación de la oleada 3:** build limpio (6 trozos nuevos bajo demanda); batería entera en verde; verify:paridad ampliado con 32 checks de la oleada (104 en total: las 6 tarjetas con destino, las 6 secciones en el tipo y en App, las fuentes de datos de cada pantalla y las declaraciones honestas presentes); verify:inventario OK; auditoría visual sintética repetida con la matriz ampliada a 23 vistas (las 6 nuevas incluidas, llegando por su tarjeta de «Más») × claro/oscuro × 360/1280 = 92 combinaciones. Manifiesto de GitHub: 109 rutas.

---

## Apéndice OLEADA 3b — Tarjetas de contactos de Cuentas/Cobrar (26-oct, orden de Yadir 09:31)

**Qué difería.** La vista «Clientes» de Cobrar del clon usaba una tarjeta propia (avatar con iniciales, varias cifras y chips de diseño local) que no se parecía a la del original. **Qué se portó** (regla a regla desde `ClientesPanel`, App.tsx:10690 del original, y su CSS en theme.css:3717-3865 y :11234): tarjeta `contact-card-oneui account-tinted-card` con `--card-accent` por estado de pago derivado como `loadClientProfiles` del servidor (casa→amarillo/`var(--gold)`, trabajador→morado `#7c3aed` o rojo si vencido, cliente→rojo si morosa o media >7 días, verde si paga en ≤7 días, neutro sin historial) y etiquetas literales («Administrativo · consumo de la casa», «Trabajador · plazo de 15 días hábiles para pagar», «Buena paga: suele pagar dentro del plazo de 7 días»…); fila de llamada con avatar de 64 px, botón de llamada verde `#13a85a` (`tel:` real) y botón SMS (`sms:` real); identidad centrada (nombre, Móvil, Correo, CI salvo identidad de trabajador, Dirección); banda «Enlazado con RH · CI · Cuenta» cuando el contacto enlaza con una ficha de RH (derivación `workerKeyForAccount`, con la regla Nelson/Nelsito); stats Cuentas / Pendientes / **Días al pagar** (media de días reales de pago, con decimales como el original); «Debe ahora: X CUP» **solo** si el saldo pendiente es > 0 (regla del dueño); tocar la tarjeta filtra sus cuentas, como en el original. Buscador fijo con el placeholder literal y chips de categoría Todas/Clientes/Trabajadores/Administrativo.

**Fotos de clientes — estado verificado.** El original muestra la foto del cliente en el avatar de la tarjeta de contacto y, vía `debtorAvatar`, en las partidas pagadas y cabeceras de grupo de cuentas; sin foto usa `default-person-avatar`. En el clon: las 4 `foto-cliente` extraídas (dayami-daya, ismael-morales-vivas, jesus, noel) se sirven desde la tabla `media`; y el avatar genérico va **empaquetado en el código del clon** (`src/assets/default-person-avatar.jpg`, sha256 `b19de296…`, byte a byte el archivo que el original importa desde su `assets/`), así que el respaldo se ve siempre — también en modo local o antes de aplicar `media-import.sql` — y nunca cae a iniciales (defectos corregidos en esta oleada: antes el clon caía a iniciales con el color de la persona). Nota de GitHub: ese `.jpg` es binario; viaja dentro del zip (dist) y el push por `push-files` (solo texto) no lo puede llevar — queda anotado en el manifiesto. `receivablePhotos` (24) NO son fotos de personas: son la foto contable diaria de cuentas y el clon ya las trata como tal. Las fotos de productos están cableadas por la misma tabla `media` (Productos.tsx:238,254): se verán al aplicar `media-import.sql` y subir el zip; sin defecto de código. Cliente/producto sin foto va sin foto, como en el original.

**Declarado (no fingido).** La ficha personal (teléfono, correo, CI, dirección, notas) no viaja en el respaldo: llega solo lo que trae la ficha RH de los trabajadores; el resto se muestra vacío como hace el original con campos sin dato. Editar contacto, subir foto, fusionar duplicados y eliminar son acciones del servidor original: no se portan (filas 161-164 del inventario) y la pantalla lo declara al pie.

## Apéndice OLEADA 3c — Sistema solar animado (26-oct, orden de Yadir 09:38)

**Causa.** En el clon no existía ninguno de los tres `@keyframes` (`ipv-planet-float`, `ipv-heartbeat`, `ipv-node-orbit`) ni el bloque `@supports (width: 1cqw)`: las clases declaraban animaciones contra keyframes ausentes y los nodos quedaban fijos en su posición inicial («estático como una foto»). Tampoco existía la pausa fuera de pantalla. **Puerto** (valores byte a byte de theme.css): los dos keyframes, el bloque `@supports` completo con `container-type: size`, la órbita con 17 paradas (`--ipv-dx0..15`/`--ipv-dy0..15` × 1cqw/1cqh − 50%), su bloque `prefers-reduced-motion`, las reglas `.is-visible`/`.is-paused` de la constelación y el `IntersectionObserver` del original (rootMargin 80px, threshold 0.02 + visibilitychange) en `IpvNeuralMap`. El fondo de `.ipv-neural-constellation` ya era idéntico al original (mismos degradados); no hay contenedor extra con fondo propio. **Barrido anti-recurrencia**: de todo el CSS del clon, 6 nombres referenciados sin definición → portados `md-fade-up`, `system-status-ring`, `dna-problem-blink`; `warehouse-spin` no está definido **ni en el original** (su spinner también está quieto allí): el clon lo define como rotación simple — mejora declarada, no espejo. El barrido quedó como puerta permanente en `verify:paridad` (67 animaciones referenciadas, todas definidas) y la auditoría visual demuestra el movimiento muestreando los centros de los nodos orbitales en dos instantes (ver informe de auditoría).

## Apéndice OLEADA 3d — Paridad claro/oscuro sistemática (26-oct, orden de Yadir 09:41)

**Método.** Barrido regla a regla: se calculan los estilos efectivos por esquema (base + `@media (prefers-color-scheme)`) del theme.css original y de todo el CSS del clon, resolviendo `var()` contra las variables de cada esquema, y se comparan solo las propiedades que el original adapta por esquema. **Causa raíz**: la paleta oscura del clon era verde (fondo `#0a1411`, `--deep` fijo `#0b3d2e`) y la del original es pizarra azulada. **Alineación de tokens en `src/index.css`**: oscuro `--bg #0c141b`, `--surface #14222c`, `--surface-alt #1b2d39`, `--surface-tonal #182832`, `--border #29404d`, `--text #edf5f8`, `--dim #a7bac5`, `--deep #102b27`, `--deep-2 #143d35`, `--turquoise-soft #17343b`, sombras de tarjeta del original; claro: sombras y `--chart-grid` del original y variables que faltaban (`--chart-sky`, `--chart-cursor`, `--button-shadow`, `--space-*`, textos de Queen). **Puertos de componentes**: `.chip` (fondo surface + borde), `select` (borde turquesa), `.queen-orb` y su imagen por esquema, `.tab-header-chip` oscuro, `.queen-panel-count-warn` oscuro, `.lab-card`, tarjetas de Elaboración en oscuro (sombra y textos legibles de pestaña activa/receta lista), el conjunto ADN de Sistema (colores de cambio, nodos, peldaños y riel por esquema), sombras de `.system-area`/evolución/actividad, borde de `.smart-summary` (= `var(--border)` del original) y sombra oscura de `.elaboration-bar-card`. **Residuo final del barrido: 2 entradas, ambas documentadas** — `.btn { box-shadow: none }` (regla permanente del dueño: botones sin sombras; gana a la fidelidad) y `.system-change-list span` (selector fantasma: no se renderiza en el clon; su CSS es residual sin efecto visible). No se tocaron: el fondo aurora `--ambient-bg` (aprobado por Yadir) ni los fondos auto-contenidos de `.queen-organism`/etapa de evolución (adaptan por esquema dentro del propio componente; en el original el fondo vive en otro elemento).

## Apéndice OLEADA 3e — Tarjetas de cuenta de Cobrar (26-oct, orden de Yadir 09:46)

**Puerto literal de `pendingCard`/`paidItem` y `vigenciaCuenta` (App.tsx:886-958, 11540+).** La tarjeta del clon usaba una fórmula propia de envejecimiento (hsl 145→0, saturación 62 %, lightness 66→42) y mostraba avatar también en pendientes. Ahora: color de vigencia con la fórmula del original (hue 142→0, `hsl(h,72%,54→48%)`, suave `hsla(h,72%,48%,.14)`, borde `hsla(h,72%,44%,.6)`), etiquetas y detalle literales («Vigente · recién creada», «Vence hoy», «Morosa · plazo vencido», «venció el … · pasó el plazo de N días…»), **ventana del trabajador en días HÁBILES** (el clon contaba días naturales: `addBusinessDaysISO`/`businessDaysElapsed` portados a `lib/utils` y `dueDate`/`agingRatio` alineados); marcas fijas PAID (vars `--paid*`), HOUSE (`var(--gold)`, «Consumo de la casa · sin vencimiento ni aviso de demora») y WORKER (`#7c3aed`) para el chip de categoría; estructura del original: nombre semibold 14 px con insignia «Del IPV»/«Manual» y chip de categoría, sublínea 11 px «fecha · hace N días · detalle», importe a la derecha en display 18 px con «Debe X de Y · abonado Z», bloque de marca (chip con punto + detalle + barra de 6 px), borde de tarjeta por estado y `box-shadow: inset 3px 0 0` del color de la marca, tinte `account-tinted-card`, radio 16 px (24 px desde 640 px, como el `sm:` del original). **Sin avatar en pendientes** (como el original); la pagada lleva el avatar de 44 px y su bloque de marca «Pagada». **Diferencia declarada**: el original distingue la morosa «de archivo» (`morosaSince`) de la vencida por calendario; ese dato no viaja, así que la tarjeta del clon presenta la vencida con la forma de vencida del original («Morosa · plazo vencido» + su detalle). El ActionMenu del original (registrar pago, mover a morosas, editar, eliminar) es acción de servidor no portada; el clon conserva su botón «Abonar», el arrastre (pagar/historial) y la cronología al tocar, que ya espejaban ese comportamiento.

---

## Cierre de la ronda completa (oleadas 3–3e, 26-oct)

**Entregable:** `queen-sda-dist.zip` regenerado con todo junto — **756.041 B, sha256 `c8f9c9d74c7439f5c412ed05564b77f3302d67f48790d3b13d7ae0de38d6fd8a`, 40 entradas** (sustituye al de 720.922 B / `4a59156f…`). Contenido: el `dist/` verificado, con las 6 pantallas nuevas como trozos propios y el avatar genérico empaquetado.

**Puertas, todas en verde sobre el dist entregado:** build limpio; `verify:import` OK contra AMBOS respaldos (23 días/2.662.090 y 24 días/2.786.190, cuadre 0, las 5 colecciones íntegras); `verify:ipv`, `verify:rh-sync`, `verify:economia` OK; productos 32 ok; documentos 68/68; queen 46 ok; automatizaciones 42 ok; `verify:paridad` **113 ok, 0 fallos** (incluye como puertas permanentes el barrido de animaciones referenciadas-vs-definidas, los keyframes y el `@supports` del solar, las tarjetas de contacto/cuenta y la paleta oscura alineada); `verify:inventario` OK — **recuento final: PRESENTE 235 · PARCIAL 202 · AUSENTE 558** (de 995).

**Auditoría visual sintética final** (`audits/audit-2026-10-26/report.json`): 23 vistas × claro/oscuro × 360/1280 = **92 combinaciones, 0 defectos duros, 0 errores JS, 0 desbordes de página**, CSS auditado byte-idéntico al de dist. **Movimiento del solar demostrado** en claro y oscuro: 8 nodos `.ipv-orbit-item` con `animation-name: ipv-node-orbit` cuyos centros difieren entre dos muestras separadas 1200 ms. Avisos blandos (59): los de siempre (subtítulo de marca con elipsis a 360, etiquetas `sr-only` medidas por el harness, nombres largos del organigrama, etiquetas anguladas de gráficos, un toque del inmune a 1280 claro sin tarjeta) — ninguno es defecto duro ni nuevo de esta ronda.

**Divergencias visuales que QUEDAN tras la ronda (lista explícita, por pantalla):**
- **Global** — `.btn { box-shadow: none }`: el original sombrea algunos botones; la regla del dueño «botones sin sombras» gana a la fidelidad. Y el fondo aurora `--ambient-bg` es el aprobado por Yadir, no el fondo plano del theme.css.
- **Sistema** — CSS residual de selectores que el clon no renderiza (p. ej. `.system-change-list`): sin efecto visible; el barrido lo cuenta como DISTINTO solo por completitud. `warehouse-spin` está definido en el clon y **no** en el original (allí ese spinner también está quieto): divergencia a favor, declarada.
- **Queen** — el anillo de salud vive en `.queen-organism-expression`; en el original vive en `.queen-orb-health-aura` (no portado como elemento): misma información, otro elemento.
- **Cobrar/Cuentas (contactos)** — la ficha personal no viaja en el respaldo: teléfono/correo/CI/dirección solo existen vía la ficha RH de trabajadores; el resto se ve vacío como en el original con campos sin dato. Correo: ningún contacto trae correo en los datos que viajan («Sin correo»). Fotos: 4 clientes vía tabla media + avatar genérico empaquetado; el resto, avatar genérico — igual que el original sin foto.
- **Cobrar (cuentas)** — el clon no distingue la morosa «de archivo» (`morosaSince` no viaja) de la vencida por calendario: presenta la vencida con la forma de vencida del original. El ActionMenu de la tarjeta (registrar pago/mover a morosas/editar/eliminar) es acción de servidor no portada; el clon conserva «Abonar», arrastre y cronología.
- **Oleada 3 (lecturas)** — Entradas sin fotos de factura ni PDF (no viajan / no se genera), Extras sin CRUD ni PDF, Existencias sin ajustes manuales, Archivo sin la acción de archivar mes, Cronología sin el historial interno de acciones de RH, Ajustes sin edición de perfil ni PIN/biometría (sustituidos por la capa de acceso): todo declarado EN pantalla y en su fila del inventario; la lectura es espejo con los datos reales.
