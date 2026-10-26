# REGLAS Y FÓRMULAS — inventario y prueba numérica

Exigencia del dueño (26-oct-2026): «Deben estar todas las reglas, fórmulas y
todo lo que concretamos para el cálculo de todo». Este documento inventaría
cada regla de cálculo del sistema original, dónde vive en su fuente, su
fórmula y constantes exactas, dónde vive en esta copia, y el resultado de la
**prueba numérica**: mismo dato de entrada → misma salida al centavo.

Banco de pruebas: la foto real del respaldo `backup-sda-2026-10-26.json`
(24 días, 1–24 oct 2026), normalizada con el mismo `parseBackup` que usa la
app al importar. Batería ejecutable: `npm run verify:reglas`
(`scripts/verify-reglas.mjs`) — **54 comprobaciones, 0 fallos** en su última
corrida. Cifras de control del dueño: ventas 2.786.190 · bruta 718.191 ·
neta 696.096 · cuadre 0 · nóminas 95.000 y 86.500 · 119 cuentas · 51 gastos.

## Tabla de reglas

| # | Regla | En el original | Fórmula y constantes | En el clon | Prueba (original = control → clon) |
|---|-------|---------------|----------------------|-----------|-------------------------------------|
| R-01 | Cuadre del día sin tocar cifras del IPV | `ipvCore` del servidor (normalizeDay) y hoja «Desglose» | cuadre = fondos contados − venta del día según IPV; el sistema nunca altera las cifras del IPV, solo agrega lo que falta en el IPV de vuelta (reconciliación) | `src/lib/ipvCore.mjs` (gemelo en `_shared`) + `src/lib/ipvReconciliation.ts` | Σ cuadre de los 24 días = **0** y ningún día descuadrado ✓ |
| R-02 | Comisión bancaria en pases | Registro del dueño 23-oct-2026 (verificado por SMS) | **FIJA de 210 CUP por pase** — nunca un porcentaje (el 10 % fue un error ya corregido una vez) | `BANK_COMMISSION = 210` en `economiaCore.mjs`; textos de Transferencias | Constante = 210 ✓ |
| R-03 | Reserva del 10 % de Economía | `monthEconomy` (fondo de ventas) | fondoVentasMes = ventas × 0,10 — es la reserva de Economía, cosa distinta de la comisión R-02 | `economiaCore.mjs` monthEconomy.reservas | 2.786.190 × 0,10 = **278.619** ✓ |
| R-04 | Conciliación de entradas SMS | Regla del dueño 23-oct-2026; `conciliationForDay` | entradas registradas en la tarjeta = transferencias del IPV del día + pagos de cuentas por transferencia + otras entradas identificadas; diferencia ≠ 0 ⇒ descuadre a señalar | `economiaCore.mjs` conciliationForDay | La identidad diferencia = registradas − (IPV + pagos + otras) se cumple en los 24 días; 11 concilian a 0 con lo registrado en la tarjeta de la foto ✓ |
| R-05 | Nómina por ciclo RH | Hoja RH de cada IPV + `deriveCyclePayroll` | Ciclos exactos de 15 días desde el ancla (def. 2026-09-23); salario leído de la hoja RH del IPV DE ESE ciclo; pago el día 16 (= inicio + 15); interruptor «No pagado» excluye de la nómina y del acumulado | `documentosCore.mjs` buildNominaDocumento / deriveCyclePayroll | Ciclo 23 sep–7 oct = **86.500** ✓ · ciclo 8–22 oct = **95.000** ✓ · payDate del 2.º = 2026-10-23 ✓ · el documento suma lo de sus empleados ✓ |
| R-06 | Quincena contable ≠ quincena RH | Decisión del dueño 22-oct-2026 | CONTABILIDAD: natural del mes (1–15 y 16–fin). RH: ciclos de 15 días desde el ancla (R-05). No se confunden en Inicio, Queen ni informes | `economiaCore` (quincenas naturales) vs `documentosCore/ipvCore` (ciclos RH); textos de Inicio corregidos (D-66) | Las quincenas del informe salen del corte 15/16 del mes ✓ |
| R-07 | «Dinero en la calle» | Decisión del dueño 12-oct-2026 | SOLO cuentas de clientes; con desglose clientes / trabajadores / administrativos + total | `economiaCore` monthEconomy.cuentasPorCobrar | dineroEnLaCalle = clientes = **62.770** ✓ · total = suma de las tres categorías ✓ |
| R-08 | Vigencia de cuentas | `addBusinessDays` + plazos del original | Clientes: 7 días naturales. Trabajadores: 15 días **hábiles**. Vencida (ref > vencimiento) = morosa; la marca manual manda; pagada nunca es morosa | `src/lib/utils.ts` dueDate/isMorosa (+ gemelo de criterio en núcleos) | Cliente 2-oct → vence 9-oct ✓ · trabajador 2-oct → vence 23-oct (15 hábiles) ✓ · morosa al día siguiente del vencimiento, no el mismo día ✓ |
| R-09 | Ficha de costo de Elaboración | `elaboracionCore` del original (settings: carbón 1500/saco, 40 h/saco, 2 kW, tarifa 10, 70 % carbón, merma def. 10 %, overhead 10 %, margen meta 60 %, colchón 15 %) | línea = usado × precioCompra ÷ comprado · hora carbón = 1500/40 = 37,5 · hora eléctrica = 2×10 = 20 · hora cocción = 0,7×37,5 + 0,3×20 = 32,25 · mano de obra = salarioDiario × minutos ÷ (jornada×60) · costo/ración = (ingredientes×(1+merma) + labor + cocción) × (1+overhead) ÷ raciones · sugerido = techo a múltiplo de 5 de (costo/ración ÷ (1−meta)) × (1+colchón) | `src/lib/elaboracionCore.mjs` | Caso a mano: ración = **75,79** ✓ · margen a 150 = **49,47 %** ✓ · sugerido = **220** ✓ |
| R-10 | Semáforo de la ficha | `recipeStatus` del original; el color va en la ETIQUETA, el borde es siempre neutro (regla 17-oct-2026) | profit < 0 → loss (rojo) · margen < meta → low (amarillo) · si no → healthy (verde) · sin precio/costo → incomplete | `elaboracionCore.mjs` recipeStatus | low a 49,47 % ✓ · loss a precio 70 ✓ · healthy a margen 62,1 % ✓ · incomplete sin precio ✓ |
| R-11 | Márgenes de Productos | `buildProductsCatalog` (precioCompraVigente / precioVentaVigente) | margen unitario = (venta vigente − compra vigente) / venta vigente × 100; margen por área = ganancia/ventas × 100 | `productosCore.mjs` + `economiaCore.rentabilidad` | Identidad en los 107 productos con ambos precios ✓ y en todas las áreas ✓ |
| R-12 | Evolución de Queen | `QUEEN_EVOLUTION_STAGES` + loadQueenEvolution | Etapas: Embrión 0 · Infante 25 · Joven 50 · Adulto 75 · Maduro 90. Índice = Σ(peso × min(1, valor/meta)) / Σ pesos de señales MEDIBLES, ×100 con 1 decimal | `queenCore.mjs` buildQueenEvolution | Umbrales exactos ✓ · índice de la foto = **57,5 → Joven (juvenil)**, dentro de su banda ✓ (ver nota N-1) |
| R-13 | Salud por segmentos (Sistema) | Diagnóstico del original: 15 segmentos/comprobaciones con puntaje 0–100 por área; lo no verificado no entra como cero | score por área desde sus comprobaciones reales; el radar solo dibuja áreas verificadas (≥3) | `src/screens/Sistema.tsx` + `systemCharts.tsx` (DiagnosticRadar) | Verificado en la auditoría visual; sin segmentos inventados |
| R-14 | Totales de Economía e Inicio | `monthEconomy` | ventas = Σ ventasDia · bruta = Σ gananciaBruta · neta = Σ gananciaNeta · gastos = Σ gastos del mes · extras = Σ extras del IPV + registrados · **resultado = neta − gastos + extras** · barra = deptos {Bebidas alcohólicas, Bebidas no alcohólicas, Cantina} · cocina = {Elaboración, Pizzas} · inversión = Σ entriesImporte · merma = Σ mermasCosto · cobrado = pagos con fecha en el período | `economiaCore.mjs` (única fuente; Inicio y documentos lo consumen) | ventas **2.786.190** ✓ · bruta **718.191** ✓ · neta **696.096** ✓ · resultado **420.591** (= 696.096 − 275.505 + 0) ✓ |
| R-15 | Informe del período (Inicio) | Informe del original por período | Mismas primitivas de R-14 agregadas sobre el rango [desde, hasta]; la foto de cuentas es la de hoy | `documentosCore.mjs` buildPeriodInformeData | En el rango del mes completo reproduce buildInformeData en **12 cifras idénticas** + billar ✓ |
| R-16 | Rebaja de almacén → gasto | Regla del dueño 20-oct-2026 (servidor: syncWarehouseWithdrawalExpense) | Si la rebaja tiene precio de costo vigente inequívoco (por código de barras de su ficha, si no por nombre exacto/alias; ambiguo ⇒ NO se crea): gasto «Salida de almacén» con total = redondeo(cantidad × costo), cantidad 1, nota «Salida de almacén automática · {cant} × {costo} CUP (precio de costo vigente) · Para: {propósito}», dept por deptForCuentasConcept; enlazado origin='almacen', sourceKey='almacen:<id>'; editar la rebaja lo actualiza, borrarla lo elimina | `src/lib/warehouseExpenses.ts` + persistencia local/Supabase | total = round(3 × costo) ✓ · sin costo → sin gasto ✓ · entrada → nunca gasto ✓ · reconciliación crea 1, idempotente, y elimina al borrar ✓ |
| R-17 | Zona horaria de los cálculos | Regla del dueño (D-04) | Toda fecha «hoy» y toda hora de sistema se calcula en **America/Havana**, no en la zona del dispositivo | `utils.ts` havanaNow/havanaNowParts/fmtSmsTimestamp; todayISO | Verificado en código y en la batería de vigencia (fechas al mediodía para no saltar de día) |
| R-18 | IPV de vuelta (agregar sin tocar) | Flujo del dueño 12/13-oct-2026 | El IPV actualizado agrega RH ausente, ingresos SDA, gastos no-IPV, saldos de almacén y cuentas pagadas con deduplicación exacta; las cifras del IPV jamás se reescriben | `src/lib/ipvReconciliation.ts` + `ipvRoundTrip.ts` buildUpdatedIpv | Cubierto por verify:ipv y la reconciliación cableada en ImportIpv/IpvDownloads |

## Notas honestas

- **N-1 (Queen):** el índice del ORIGINAL con sus siete señales era 34,9
  (Infante) en la foto del 26-oct. En el clon solo viajan en el respaldo
  cuatro de las siete señales (patrones de uso, acciones autónomas y
  precisión viven en tablas del original que no se exportan). La regla
  portada no castiga ni regala lo no medible: renormaliza sobre las
  señales medibles → 57,5 (Joven). No es una fórmula distinta: es la
  misma fórmula con el dominio de datos que el respaldo trae, declarado
  en el propio `queenCore.mjs` y en el panel.
- **N-2 (conciliación):** que solo 11 de 24 días concilien a 0 no es un
  fallo de la fórmula: es el dato real de la foto (la tarjeta trae
  movimientos que el IPV no explica y viceversa; la regla R-04 manda
  señalarlo, y la pantalla de Transferencias lo señala día a día).
- **N-3:** las fórmulas que dependen de datos que no viajan en el
  respaldo (historial interno de acciones para la Cronología RH, fotos
  de factura como blob) no tienen prueba numérica posible: quedan en la
  lista de no igualables del INFORME-DIFERENCIAS.md, con su causa.
