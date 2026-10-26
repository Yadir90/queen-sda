# Despliegue de las automatizaciones en la nube — Queen SDA (clon externo)

Plan ejecutable de la puerta final. **Nada de esto está aplicado todavía.**
Proyecto Supabase: `queen-sda`, ref `ienkjlukoqmttspaefhr`
(`https://ienkjlukoqmttspaefhr.supabase.co`).

## Estado de preparación (hecho el 2026-10-26, sin desplegar)

- Los 8 núcleos de `src/lib/` están copiados en `supabase/functions/_shared/`
  (byte a byte idénticos a los originales): `automatizacionesCore`,
  `backupCore`, `documentosCore`, `economiaCore`, `ipvCore`,
  `productosCore`, `queenCore`, `syncCore`.
- Verificado: **todos** los imports relativos de `queen-backup`,
  `queen-maintenance`, `queen-bulletins` y de los propios núcleos resuelven
  a archivos existentes dentro de `supabase/functions/` (15 imports, 0 sin
  resolver). `queen-chat` (ya desplegada) no importa nada de `_shared`
  (solo el cliente de Supabase desde esm.sh): su estructura no cambia.
- Supabase CLI instalada en la VM: `~/workspace/tools/supabase/supabase`,
  versión **2.122.0** (binario oficial de GitHub releases, linux/amd64,
  sha256 verificado contra `checksums.txt` de la release).
  En los comandos de abajo se abrevia como `supabase`; si no está en el
  PATH, usar la ruta completa.

## Orden correcto (no saltarse pasos)

1. **Login de la CLI** — lo hace Lórien con el dueño presente (el token de
   acceso lo aporta el dueño; nunca se escribe en archivos ni en el chat).
2. **Bucket privado `backups`** en Storage (SQL del paso 2).
3. **Secretos**: el de funciones (`CRON_SECRET`, paso 3) y los de Vault
   (paso 4, los crea el dueño en persona en el panel). El valor de
   `CRON_SECRET` y el de `cron_secret` de Vault deben ser **el mismo**.
4. **Deploy de las 3 funciones** (paso 5).
5. **`supabase/automatizaciones-cron.sql`** en el SQL Editor (paso 6).
   Va el último: programa los trabajos que llaman a las funciones, y el
   propio archivo crea las extensiones `pg_cron` y `pg_net`
   (`create extension if not exists`), no hay que activarlas a mano.
6. **Verificación** (paso 7).

> El bucket y las funciones van **antes** que el SQL de cron: si el cron
> disparara con las funciones sin desplegar o sin el bucket, las corridas
> fallarían y quedarían registradas como error.

## Paso 1 — Login (con el dueño presente)

```bash
~/workspace/tools/supabase/supabase login
```

Pide el access token de la cuenta de Supabase del negocio; lo introduce el
dueño. Sin este paso, ningún comando de deploy funciona.

## Paso 2 — Bucket privado «backups» (SQL Editor de Supabase, pegar tal cual)

```sql
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;
```

`public = false`: el bucket es privado. Las funciones acceden con la clave
de servicio que la plataforma inyecta (`SUPABASE_SERVICE_ROLE_KEY`), que
salta las políticas de Storage; no se crea ninguna política pública.

Comprobación rápida (opcional, en el mismo editor):

```sql
select id, name, public from storage.buckets where id = 'backups';
```

## Paso 3 — Secreto de las funciones: CRON_SECRET

El dueño genera un valor secreto (una cadena larga y aleatoria, p. ej. con
un generador de contraseñas) y lo guarda: ese mismo valor se usa en el
paso 4 en Vault. Con la CLI ya logueada:

```bash
cd ~/workspace/queen-sda-app
~/workspace/tools/supabase/supabase secrets set CRON_SECRET=<EL_MISMO_VALOR_QUE_EN_VAULT> --project-ref ienkjlukoqmttspaefhr
```

El valor **no** queda escrito en ningún archivo del proyecto: vive solo
como secreto de Supabase y en Vault.

Secretos opcionales de correo (solo si se conecta Resend, ver la
advertencia al final):

```bash
~/workspace/tools/supabase/supabase secrets set RESEND_API_KEY=<CLAVE_DE_RESEND> BULLETIN_FROM=<REMITENTE_VERIFICADO> --project-ref ienkjlukoqmttspaefhr
```

## Paso 4 — Vault: lo que el dueño crea en persona en el panel

Panel de Supabase → **Database → Vault** → *Add new secret*, dos secretos:

| Nombre | Valor |
|---|---|
| `functions_base_url` | `https://ienkjlukoqmttspaefhr.supabase.co/functions/v1` |
| `cron_secret` | **El mismo valor** puesto en `CRON_SECRET` en el paso 3 |

El SQL de cron lee ambos de `vault.decrypted_secrets` en cada llamada;
por eso ningún valor secreto aparece en `automatizaciones-cron.sql`.

## Paso 5 — Deploy de las 3 funciones

```bash
cd ~/workspace/queen-sda-app
~/workspace/tools/supabase/supabase functions deploy queen-backup --project-ref ienkjlukoqmttspaefhr
~/workspace/tools/supabase/supabase functions deploy queen-maintenance --project-ref ienkjlukoqmttspaefhr
~/workspace/tools/supabase/supabase functions deploy queen-bulletins --project-ref ienkjlukoqmttspaefhr
```

`queen-chat` **no** se redespliega: ya está en producción y no depende de
`_shared/`.

## Paso 6 — Programar los trabajos (pg_cron + pg_net)

En el **SQL Editor**, pegar completo `supabase/automatizaciones-cron.sql`
y ejecutar. Crea las extensiones `pg_cron`/`pg_net` si faltan, retira
trabajos previos con el mismo nombre (reprogramar no duplica) y programa
los 5 trabajos:

| Trabajo | Horario UTC | Equivale (La Habana, UTC-4) | Llama a |
|---|---|---|---|
| `queen-backup-2345` | `45 3 * * *` | 23:45 | `queen-backup` |
| `queen-mantenimiento-0345` | `45 7 * * *` | 03:45 | `queen-maintenance` (`mantenimiento`) |
| `queen-aprendizaje-nocturno` | `5 8 * * *` | 04:05 | `queen-maintenance` (`aprendizaje`) |
| `queen-aviso-ipv-2230` | `30 2 * * *` | 22:30 | `queen-maintenance` (`aviso-ipv`) |
| `queen-boletines-10min` | `*/10 * * * *` | cada 10 min | `queen-bulletins` |

> ⚠️ **Horario de invierno:** pg_cron trabaja en UTC y los horarios de
> arriba están puestos para La Habana en **UTC-4 (verano)**. Cuando Cuba
> pase a horario de invierno (UTC-5), hay que mover cada horario **+1 h**
> en UTC (respaldo → `45 4`, mantenimiento → `45 8`, aprendizaje →
> `5 9`, aviso IPV → `30 3`) y reaplicar el SQL editado, o los trabajos
> correrán una hora antes de lo debido. Es la diferencia honesta frente
> al sistema original, que programaba en hora local.

## Paso 7 — Verificación posterior

1. **Invocar cada función una vez a mano** (con el valor de `CRON_SECRET`
   en la cabecera `x-cron-secret`; sin ella deben responder 401):

   ```bash
   curl -s -X POST https://ienkjlukoqmttspaefhr.supabase.co/functions/v1/queen-backup -H "x-cron-secret: <CRON_SECRET>" -H "Content-Type: application/json" -d '{}'
   curl -s -X POST https://ienkjlukoqmttspaefhr.supabase.co/functions/v1/queen-maintenance -H "x-cron-secret: <CRON_SECRET>" -H "Content-Type: application/json" -d '{"task":"mantenimiento"}'
   curl -s -X POST https://ienkjlukoqmttspaefhr.supabase.co/functions/v1/queen-bulletins -H "x-cron-secret: <CRON_SECRET>" -H "Content-Type: application/json" -d '{}'
   ```

   Respuestas esperadas: `queen-backup` → `{"ok":true,"filename":"backup-sda-…","control":{…}}`;
   `queen-bulletins` sin Resend conectado → `{"ok":true,"transported":false,…}`
   (ver la nota siguiente: es el comportamiento correcto, no un fallo).

2. **Los 5 trabajos existen** (SQL Editor):

   ```sql
   select jobname, schedule, active from cron.job order by jobname;
   ```

   Deben salir las 5 filas de la tabla del paso 6, todas `active = true`.

3. **La primera copia está en el bucket** (la genera la invocación manual
   de `queen-backup` del punto 1):

   ```sql
   select name, created_at from storage.objects where bucket_id = 'backups' order by created_at desc;
   ```

   Debe aparecer un `backup-sda-AAAA-MM-DD….json`. La retención es de 14
   días: la propia función retira las copias caducadas en cada corrida.

4. **El registro de automatizaciones** de la app muestra las corridas de
   respaldo / mantenimiento / boletines con su resultado (cada función
   deja su corrida registrada al terminar).

## Nota verificada — queen-bulletins sin RESEND_API_KEY

Confirmado contra el código (`queen-bulletins/index.ts` +
`automatizacionesCore.mjs`), el 2026-10-26:

- Si falta `RESEND_API_KEY` **o** falta `BULLETIN_FROM`, `buildTransport()`
  devuelve `null` y `dispatchPendingBulletins` corta antes de tocar nada:
  devuelve `transported: false` con el motivo *«Sin servicio de correo
  conectado en el sistema externo: la cola queda intacta y ningún boletín
  se marca enviado.»*
- La función **no envía nada, no marca ningún boletín como enviado** y
  registra la corrida con estado `atencion` y el detalle
  `Despacho sin envío: <motivo>`, para que quede constancia honesta en el
  registro de automatizaciones.
- Con transporte conectado, el envío pasa por `attemptBulletinSend`, que
  comprueba duplicados **inmediatamente antes de enviar** contra el índice
  de enviados (regla anti-duplicado del dueño: jamás el mismo boletín dos
  veces; jamás se marca enviado sin envío real).

> ⚠️ **Advertencia (Lórien) — antes de conectar Resend:** hay que
> reconciliar primero la cola de boletines del clon contra lo ya enviado
> desde el sistema original de Muse (que lleva meses despachando los
> boletines reales). La cola importada del clon puede contener boletines
> que el original ya envió; si se conectara Resend sin reconciliar, la
> comprobación anti-duplicado del clon no los reconocería como enviados
> (su índice parte de sus propios datos) y podrían salir **dos veces**.
> Orden seguro: reconciliar la cola → marcar en el clon lo ya enviado →
> recién entonces fijar `RESEND_API_KEY` y `BULLETIN_FROM`.
