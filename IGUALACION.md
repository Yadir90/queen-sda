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
