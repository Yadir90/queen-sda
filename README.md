# Queen SDA — Sistema de Automatización de Datos V2.0

Versión externa y **completamente gratuita** (código directo, sin constructores por créditos) del sistema del **restaurante-bar La Reina**. Es la réplica multiusuario en construcción del sistema original que vive en Muse; el sistema de Muse sigue siendo el oficial mientras esta versión no cuadre igual y el dueño la verifique.

- **Nombre correcto en todas partes:** «Queen SDA — Sistema de Automatización de Datos V2.0» · «Restaurante-bar La Reina».
- **Regla de oro:** cero datos de negocio inventados. Sin respaldo importado, todas las pantallas muestran «Sin datos todavía». El respaldo/IPV es la fuente de verdad y ninguna cifra se ajusta en silencio.

## Cómo correrla

```bash
npm install     # instala dependencias (React 19, Vite 6, TypeScript)
npm run dev     # servidor de desarrollo
npm run build   # comprobación de tipos (tsc) + construcción de producción en dist/
npm run preview # sirve la construcción de producción
npm run verify:import   # prueba del importador contra el respaldo real de referencia
```

## Estado de la v1 (fundación local-primero)

Construido y verificado el 2026-10-25:

- **Carcasa visual igualada a la referencia de interfaz:** aurora de malla suave (esmeralda `#0e9f6e` / turquesa `#0ea5bd` + toques azul `#3b82f6` y violeta `#8b5cf6`; fondo claro `#f2f7f4`, oscuro `#0a1411` con superficie `#15241e` y acento `#22c55e`), sin desenfoques pesados; tarjetas de radio 26px (22px en móvil); botones cápsula sin sombras; Georgia para titulares y cifras; tema claro/oscuro según el dispositivo; barra inferior móvil **Inicio · Cobrar · Queen · Sistema · Más** y navegación lateral en pantallas grandes.
- **PWA instalable en Android:** `manifest.webmanifest` completo (standalone, portrait, `theme_color #0e9f6e`, iconos 192/512 + maskable del reactor circular esmeralda, también en SVG) y service worker conservador registrado **solo en producción**: cachea únicamente la carcasa estática; los datos siempre van network-first.
- **Acceso local de demostración estructural** (replica la fase 1; **no** es la seguridad final): 4 perfiles —
  - Yadir Medina Oliva — administrador — `yadir.medina900710@gmail.com`
  - Jesús — solo lectura — `jesusmmpatria@gmail.com`
  - Dayami Fernández — solo lectura — `dayamifernandez584@gmail.com`
  - Yan Espinosa — solo lectura — `yanespinosa08@gmail.com`
  
  Contraseña temporal inicial: la misma de la fase 1 (`Admin1`), con **cambio obligatorio al primer ingreso** (mínimo 6 caracteres para la nueva). Los perfiles viven en el navegador del dispositivo; el rol lectura no puede cobrar, importar ni restablecer.
- **Persistencia local versionada** (`localStorage`, claves `queen-sda:v1:*`): datos importados, abonos de Cobrar y sesión. Botón **«Restablecer datos locales»** en Sistema (solo admin, con confirmación).
- **Capa de datos con dos modos (local / Supabase):**
  - **Modo local (respaldo, sin configurar):** `src/lib/backend.ts` trabaja en localStorage como en la v1. Sin `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, la app entera se comporta exactamente igual que antes.
  - **Modo Supabase (configurado):** con las dos variables en `.env.local`, mandan `src/lib/supabaseClient.ts` (cliente) y `src/lib/supabaseBackend.ts`: **Supabase Auth** (`signInWithPassword`, restauración de sesión, cierre de sesión y cambio de contraseña con `updateUser`), rol y `must_change_password` leídos de `profiles`/`user_roles`, y lectura/escritura de `days`, `receivables` y `payments` bajo RLS (lectura con rol; escritura solo admin — lo impone el servidor). La capa remota convierte las filas al **mismo `StoredData`** que ya consumen las pantallas (el `payload` jsonb de cada fila se reconstruye con el mismo parser del respaldo), así que las pantallas no se reescribieron: solo el arranque, el ingreso, el cambio de contraseña, el confirmar de Cobrar y el confirmar del importador pasaron a ser asíncronos cuando el modo lo exige. Los abonos de Cobrar se insertan en `payments` con `origin='cobrar'` y vuelven como capa sobre el saldo del respaldo, igual que los abonos locales; el importador de respaldo hace upsert idempotente en el servidor. El esquema `supabase/schema.sql` **ya está aplicado** en el proyecto «queen-sda» del dueño.
  - **Importación inicial a Supabase lista:** `supabase/import-backup-2026-10-24.sql` (generado por `scripts/generate-import-sql.mjs` desde el respaldo real, con el parser de la app) carga los 23 días y las 115 cuentas con `insert ... on conflict do update`; queda **por ejecutar** en el SQL Editor del proyecto (ver «Qué falta»).
- **Importador de respaldo del SDA** (solo admin, en Sistema y en Días): acepta el JSON `{ backupOf, exportedAt, data: { days, receivables, expenses, payrollHistory, workers, transferState } }`; **antes de guardar** muestra la verificación (n.º de días, rango de fechas, suma de `ventasDia`, suma de `gananciaBruta`, suma de `gananciaNeta`, cuadre) y solo guarda tras confirmación; es **idempotente** (días por fecha y cuentas por id: reimportar no duplica) y conserva los abonos locales de Cobrar aplicándolos sobre las cuentas importadas. La lógica vive en `src/lib/backupCore.mjs`, compartida por la app y por la prueba de Node.
- **Pantallas funcionales con los datos importados:**
  - **Inicio «DE UN VISTAZO»:** ventas del período, ganancia bruta y neta, **dinero en la calle = solo cuentas de clientes pendientes**, cuentas vencidas, último día con su cuadre, barras píldora de ventas por día con línea de media, ventas por departamento y quincena contable natural del mes (1–15 / 16–fin, sin confundir con los ciclos de RH).
  - **Días:** rejilla por mes con intensidad según la venta (marcador «Punta» en el mejor día) y detalle al tocar con las cifras tal como entraron (fondos, departamentos, cuadre).
  - **Cuentas:** tarjetas por persona que muestran **solo el total que debe hoy** (si saldó, no aparece monto), buscador, totales separados por clientes / trabajadores / administrativos + total general, plazos **clientes 7 días · trabajadores 15 días**, vencida = **morosa en rojo**, barra de envejecimiento verde→rojo, detalle con abonos y saldos.
  - **Cobrar** (solo admin): abono con fecha y método (efectivo/transferencia), **aplicado a la cuenta más antigua primero**, con pantalla de confirmación previa que muestra el reparto exacto.
  - **Queen y el resto de secciones de Más:** estados honestos «llega en la siguiente fase», sin cifras ni respuestas de ejemplo.
- **Importación de IPV en Excel:** queda para la siguiente fase; en la v1 los días entran por el importador de respaldo.

## Verificación (hecha el 2026-10-25)

1. `npm run build` — **sin errores** (tsc + Vite; `dist/` de ~266 KB de JS, 82 KB gzip).
2. `node scripts/verify-import.mjs` contra el respaldo real `backup-sda-2026-10-24.json` — **OK, 8/8 comprobaciones**, usando la misma lógica de la app:

   | Total de control | Esperado | Obtenido |
   |---|---|---|
   | Días | 23 | 23 |
   | Rango | 2026-10-01 → 2026-10-23 | 2026-10-01 → 2026-10-23 |
   | Ventas totales (CUP) | 2 662 090 | 2 662 090 |
   | Ganancia bruta (CUP) | 667 141 | 667 141 |
   | Ganancia neta (CUP) | 645 576 | 645 576 |
   | Cuadre total | 0 | 0 (los 23 días a 0) |

   Además el parser lee 115 cuentas, 51 gastos, 2 nóminas y 25 trabajadores del mismo respaldo.

### Conexión a Supabase (2026-10-25, segunda pasada)

3. `npm install @supabase/supabase-js` (v2.118.0) y `npm run build` de nuevo — **sin errores**; el paquete crece a ~498 KB de JS (143 KB gzip) por la librería de Supabase, y el bundle compilado contiene el host del proyecto configurado en `.env.local` (la clave publishable viaja en el bundle por diseño: es pública y la seguridad la pone RLS; **nunca** debe usarse ahí la clave `service_role`).
4. `node scripts/generate-import-sql.mjs` — generó `supabase/import-backup-2026-10-24.sql` tras comprobar los totales de control contra el respaldo, y el archivo generado se **releyó y verificó de forma independiente**: 23 filas de días (2026-10-01 → 2026-10-23), sumas desde las columnas del propio SQL = ventas **2 662 090**, bruta **667 141**, neta **645 576**, cuadre **0**; 115 filas de cuentas con ids únicos; los 138 payloads jsonb (23 + 115) son JSON válido y coinciden con su fila (la suma de ventas desde los payloads también da 2 662 090).
5. `node scripts/verify-import.mjs` tras la integración — **sigue OK, 8/8**.

**Límite honesto de esta pasada:** el modo Supabase está integrado y compila, pero **todavía no se ha ejercitado contra el proyecto en vivo**: aún no existen usuarios de Auth (nadie ha podido iniciar sesión real) y el SQL de importación aún no se ha ejecutado en el proyecto. Hasta que eso se haga, el modo probado en producción sigue siendo el local.

## Qué falta

- **Supabase — pasos del dueño (en el panel del proyecto «queen-sda»):**
  1. Crear los 4 usuarios en **Authentication → Users** (Yadir admin; Jesús, Dayami y Yan lectura) con la contraseña inicial que él defina — ninguna contraseña se escribe en este repo ni en la app.
  2. Crear la fila de cada usuario en `profiles` y `user_roles` (sin esto, la cuenta entra como lectura y RLS no le deja leer datos). Plantilla para el SQL Editor, sustituyendo el UUID de cada usuario de Auth:
     ```sql
     insert into public.profiles (id, display_name, email, must_change_password)
     values ('<uuid-del-usuario>', '<nombre>', '<correo>', true);
     insert into public.user_roles (user_id, role)
     values ('<uuid-del-usuario>', 'lectura');  -- 'admin' solo para Yadir
     ```
  3. Ejecutar `supabase/import-backup-2026-10-24.sql` en el SQL Editor y contrastar las dos consultas de verificación del final con los totales de control (23 días · 2 662 090 · 667 141 · 645 576 · cuadre 0 · 115 cuentas).
  4. Probar el primer ingreso real de cada cuenta (cambio obligatorio de contraseña incluido) y un abono de Cobrar como admin.
  - **Límite conocido del esquema aplicado:** la política de escritura de `profiles` es solo-admin, así que un usuario de lectura cambia su contraseña en Auth pero no puede apagar él mismo su marca `must_change_password` (la app no se bloquea: entra, pero el aviso reaparecerá en su próximo ingreso hasta que el admin lo marque o se añada una política de «cada usuario actualiza su propia marca»). Si se quiere corregir, añadir esa política en el proyecto y en `supabase/schema.sql`.
- **Despliegue gratuito en Cloudflare Pages** (500 publicaciones/mes, banda estática ilimitada) para que Jesús, Dayami y Yan entren desde sus teléfonos e instalen la PWA — con las variables `VITE_SUPABASE_*` configuradas en el despliegue para que la versión publicada arranque en modo Supabase.
- **Sincronización entre dispositivos** (llega con Supabase) y migración inicial del respaldo más fresco disponible al momento del despliegue.
- **Resto de módulos:** importador de IPV en Excel, Queen, RH y nómina, Almacén, Elaboración, Transferencias con conciliación SMS, Economía e informes, documentos y boletines.
- **Igualación visual fina** pantalla por pantalla contra el sistema original, con la verificación visual del dueño en su teléfono (la v1 iguala la carcasa y los tokens de la referencia; el interior completo aún no está replicado).

## Estructura

```
src/
  App.tsx               carcasa, navegación y pantallas de acceso (arranque en modo local o Supabase)
  index.css             tokens y componentes visuales (referencia de interfaz)
  types.ts              tipos compartidos
  lib/
    backend.ts          capa de datos/acceso LOCAL (respaldo cuando Supabase no está configurado)
    supabaseClient.ts   cliente de Supabase desde VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
    supabaseBackend.ts  Auth + lectura/escritura remota (RLS) que alimenta el mismo StoredData
    backupCore.mjs      lógica del importador de respaldo (app + prueba Node)
    backupCore.d.mts    tipos de backupCore
    utils.ts            formato CUP/fechas, saldos efectivos, plazos y morosidad
  components/           ui.tsx (tarjetas, barras), ImportBackup.tsx (local o remoto según el modo)
  screens/              Inicio, Dias, Cuentas, Cobrar, Sistema, Secciones (Queen/Más)
public/                 manifest.webmanifest, sw.js, icons/
scripts/verify-import.mjs        prueba del importador contra el respaldo real (8/8)
scripts/generate-import-sql.mjs  genera el SQL de importación inicial desde el respaldo real
supabase/schema.sql              esquema aplicado en el proyecto «queen-sda»
supabase/import-backup-2026-10-24.sql  importación inicial (23 días, 115 cuentas) por ejecutar
```
