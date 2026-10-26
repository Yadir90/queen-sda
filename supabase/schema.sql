-- Queen SDA — Sistema de Automatización de Datos V2.0
-- Esquema para Supabase (Postgres). APLICADO el 2026-10-25 en el proyecto
-- «queen-sda» del dueño (las 5 tablas existen y RLS está activo).
-- Roles: 'admin' (escribe) y 'lectura' (solo lee), replicando la fase 1.
-- RLS activo en todas las tablas: lectura para ambos roles, escritura solo admin.
--
-- PUERTA DE CALIDAD FINAL (2026-10-25): el archivo COMPLETO quedó
-- idempotente — se puede pegar entero en el SQL Editor sobre el
-- proyecto ya creado y no falla ni toca datos: el bloque base adoptó
-- la misma forma que los bloques de fases (create table/index if not
-- exists, drop policy if exists antes de cada create policy, tipo
-- enum protegido). Dos correcciones de políticas en el bloque base:
-- (1) payments: la escritura del admin pasa a «for all» (la app
-- reapunta abonos tras una fusión verificada de cuentas con UPDATE;
-- con la política solo-insert ese UPDATE lo denegaba RLS en silencio
-- y el DELETE de la cuenta fusionada podía arrastrar el abono por la
-- FK en cascada); (2) profiles: cada usuario puede actualizar SU
-- propio registro (apagar su marca must_change_password tras cambiar
-- la contraseña, el límite conocido de la fase 1).

do $$
begin
  create type public.app_role as enum ('admin', 'lectura');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'lectura'
);

create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() = 'admin', false)
$$;

-- Días importados (del IPV / del respaldo del SDA). El respaldo es la fuente de verdad.
create table if not exists public.days (
  date date primary key,
  ventas_dia numeric not null default 0,
  ganancia_bruta numeric not null default 0,
  ganancia_neta numeric not null default 0,
  cuadre numeric not null default 0,
  payload jsonb not null default '{}'::jsonb, -- día completo tal como entró (departamentos, fondos, RH)
  imported_at timestamptz not null default now()
);

-- Cuentas por cobrar.
create table if not exists public.receivables (
  id text primary key,               -- id del sistema original
  client text not null,
  client_key text not null,
  category text not null check (category in ('cliente', 'trabajador', 'administrativo')),
  date date not null,
  original_amount numeric not null default 0,
  saldo numeric not null default 0,   -- saldo según la fuente (respaldo/IPV)
  status text not null default 'pendiente',
  close_kind text,
  detail text not null default '',
  payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);
create index if not exists receivables_client_key_idx on public.receivables (client_key);
create index if not exists receivables_category_idx on public.receivables (category);

-- Abonos (pagos) sobre cuentas: los del respaldo y los registrados en Cobrar.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id text not null references public.receivables (id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_date date not null,
  payment_method text not null check (payment_method in ('efectivo', 'transferencia')),
  origin text not null default 'cobrar',  -- 'respaldo' | 'cobrar'
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists payments_receivable_idx on public.payments (receivable_id);

-- RLS: lectura para cualquier usuario autenticado con rol; escritura solo admin.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.days enable row level security;
alter table public.receivables enable row level security;
alter table public.payments enable row level security;

drop policy if exists "profiles: leer el propio" on public.profiles;
create policy "profiles: leer el propio" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles: admin escribe" on public.profiles;
create policy "profiles: admin escribe" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());
-- Cada usuario actualiza SOLO su propio registro (apagar su marca
-- must_change_password tras cambiar la contraseña). No da acceso a
-- filas ajenas ni a ninguna otra tabla.
drop policy if exists "profiles: actualizar el propio" on public.profiles;
create policy "profiles: actualizar el propio" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "user_roles: leer el propio" on public.user_roles;
create policy "user_roles: leer el propio" on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "user_roles: admin escribe" on public.user_roles;
create policy "user_roles: admin escribe" on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "days: lectura con rol" on public.days;
create policy "days: lectura con rol" on public.days
  for select using (public.current_role() is not null);
drop policy if exists "days: admin escribe" on public.days;
create policy "days: admin escribe" on public.days
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "receivables: lectura con rol" on public.receivables;
create policy "receivables: lectura con rol" on public.receivables
  for select using (public.current_role() is not null);
drop policy if exists "receivables: admin escribe" on public.receivables;
create policy "receivables: admin escribe" on public.receivables
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payments: lectura con rol" on public.payments;
create policy "payments: lectura con rol" on public.payments
  for select using (public.current_role() is not null);
drop policy if exists "payments: admin escribe" on public.payments;
create policy "payments: admin escribe" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- FASE DE INTEGRACIÓN (sincronización derivada del IPV + RH).
-- Bloque IDEMPOTENTE: se puede (re)aplicar sobre el proyecto ya
-- creado sin tocar lo existente. Nuevas colecciones del núcleo:
-- gastos, registro de trabajadores, historial de nóminas y ajustes
-- del núcleo (ancla de RH, alias aprendidos, «No pagado», ajustes
-- manuales de nómina). RLS: lectura con rol / escritura solo admin,
-- igual que el resto del sistema.
-- ============================================================

create table if not exists public.expenses (
  id text primary key,
  date date not null,
  concept text not null default '',
  category text not null default '',
  dept text not null default '',
  quantity numeric not null default 1,
  unit_value numeric not null default 0,
  total numeric not null default 0,
  origin text not null default 'manual',   -- 'manual' | 'ipv-cuentas' | 'auto-rh' | otros del respaldo
  source_key text,                          -- «fecha::concepto» de los gastos del Desglose del IPV
  cycle_start date,                         -- ciclo de la nómina (gastos 'auto-rh')
  note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (date);
create index if not exists expenses_origin_idx on public.expenses (origin);

create table if not exists public.workers (
  key text primary key,                     -- clave canónica de la persona
  nombre text not null,
  ocupacion text not null default '',
  carnet text not null default '',
  cuenta_bancaria text not null default '',
  movil text not null default '',
  notas text not null default '',
  origen text not null default 'ipv',       -- 'ipv' | 'manual'
  role_kind text not null default 'trabajador',  -- 'direccion' | 'trabajador'
  payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

create table if not exists public.payroll_history (
  cycle_start date primary key,
  cycle_end date not null,
  pay_date date not null,
  total numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,  -- registro completo (empleados con su desglose)
  imported_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,  -- fila 'core': ancla, alias, aprendidos, overrides, suprimidas, no-pagados, ajustes de nómina
  updated_at timestamptz not null default now()
);

alter table public.expenses enable row level security;
alter table public.workers enable row level security;
alter table public.payroll_history enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "expenses: lectura con rol" on public.expenses;
create policy "expenses: lectura con rol" on public.expenses
  for select using (public.current_role() is not null);
drop policy if exists "expenses: admin escribe" on public.expenses;
create policy "expenses: admin escribe" on public.expenses
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "workers: lectura con rol" on public.workers;
create policy "workers: lectura con rol" on public.workers
  for select using (public.current_role() is not null);
drop policy if exists "workers: admin escribe" on public.workers;
create policy "workers: admin escribe" on public.workers
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payroll_history: lectura con rol" on public.payroll_history;
create policy "payroll_history: lectura con rol" on public.payroll_history
  for select using (public.current_role() is not null);
drop policy if exists "payroll_history: admin escribe" on public.payroll_history;
create policy "payroll_history: admin escribe" on public.payroll_history
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "app_settings: lectura con rol" on public.app_settings;
create policy "app_settings: lectura con rol" on public.app_settings
  for select using (public.current_role() is not null);
drop policy if exists "app_settings: admin escribe" on public.app_settings;
create policy "app_settings: admin escribe" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());


-- ============================================================
-- FASE ECONOMÍA + TRANSFERENCIAS. Bloque IDEMPOTENTE: se puede
-- (re)aplicar sobre el proyecto ya creado sin tocar lo existente.
-- Historial de la tarjeta del negocio: los movimientos viajan tal
-- como el sistema original los registró (importe con signo, marca
-- «No es de La Reina» en `excluded`, anulaciones del original en
-- `superseded`); el saldo y los totales se derivan al leer, nunca
-- se guardan recalculados. RLS: lectura con rol / escritura solo
-- admin, igual que el resto del sistema.
-- ============================================================

create table if not exists public.transfer_movements (
  id text primary key,                       -- «ts-hN» del respaldo | «ts-local-…» de esta copia
  date date not null,
  type text not null default 'abono',        -- 'abono' | 'pase' | 'gasto' | 'reversion'
  source text not null default 'manual',     -- 'ipv' | 'pago-cuenta' | 'manual' | 'pase' | 'extra' | 'gasto-transferencia'
  amount numeric not null default 0,         -- con signo: + entra, − sale
  detail text not null default '',
  excluded boolean not null default false,   -- «No es de La Reina»: visible tachado, fuera del saldo
  superseded boolean not null default false, -- anulado por el sistema original (anti doble conteo)
  pase_id integer,                           -- id en el registro de pases del respaldo
  manual_id integer,
  payment_credit_id integer,
  extra_id integer,
  transfer_expense_id integer,
  pase_kind text,                            -- 'banco' | 'efectivo' (clase del pase)
  payload jsonb not null default '{}'::jsonb, -- movimiento completo tal como entró
  imported_at timestamptz not null default now()
);
create index if not exists transfer_movements_date_idx on public.transfer_movements (date);
create index if not exists transfer_movements_source_idx on public.transfer_movements (source);

alter table public.transfer_movements enable row level security;

drop policy if exists "transfer_movements: lectura con rol" on public.transfer_movements;
create policy "transfer_movements: lectura con rol" on public.transfer_movements
  for select using (public.current_role() is not null);
drop policy if exists "transfer_movements: admin escribe" on public.transfer_movements;
create policy "transfer_movements: admin escribe" on public.transfer_movements
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- FASE PRODUCTOS + ELABORACIÓN + ALMACÉN. Bloque IDEMPOTENTE: se
-- puede (re)aplicar sobre el proyecto ya creado sin tocar lo
-- existente. Las referencias de paquetes y rendimientos de
-- Elaboración se guardan SOLO cuando el dueño las confirma (lo que
-- Queen aprende de Gastos se calcula al leer y no escribe nada
-- solo). La referencia completa viaja en `payload` (con sus
-- observaciones) y se reconstruye idéntica al releer. RLS: lectura
-- con rol / escritura solo admin, igual que el resto del sistema.
-- Productos, el libro de existencias y el almacén NO necesitan
-- tablas nuevas: se derivan de los días del IPV ya guardados.
-- ============================================================

create table if not exists public.package_references (
  id text primary key,                       -- id estable de la referencia
  name text not null default '',             -- nombre del insumo (para ordenar/buscar)
  payload jsonb not null default '{}'::jsonb, -- referencia completa con sus observaciones
  updated_at timestamptz not null default now()
);
create index if not exists package_references_name_idx on public.package_references (name);

alter table public.package_references enable row level security;

drop policy if exists "package_references: lectura con rol" on public.package_references;
create policy "package_references: lectura con rol" on public.package_references
  for select using (public.current_role() is not null);
drop policy if exists "package_references: admin escribe" on public.package_references;
create policy "package_references: admin escribe" on public.package_references
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- FASE DOCUMENTOS Y BOLETINES (bloque nuevo, idempotente)
-- Cola de boletines diarios: un boletín por día importado, con
-- su estado (pendiente/enviado/error). El contenido completo
-- (asunto, HTML, texto y cifras) viaja en el payload; la app
-- también lo deriva al leer, así que una tabla ausente se lee
-- como vacía sin romper nada.
-- Los DOCUMENTOS (nómina, informe, menú, presentación y
-- respaldo) NO necesitan tablas: se generan en el navegador
-- desde los datos ya guardados, como en fases anteriores.
-- ============================================================

create table if not exists public.bulletins (
  id text primary key,                        -- id estable «<fecha>-import»
  date date not null,                         -- día del boletín
  payload jsonb not null default '{}'::jsonb, -- boletín completo con su estado
  updated_at timestamptz not null default now()
);
create index if not exists bulletins_date_idx on public.bulletins (date desc);

alter table public.bulletins enable row level security;

drop policy if exists "bulletins: lectura con rol" on public.bulletins;
create policy "bulletins: lectura con rol" on public.bulletins
  for select using (public.current_role() is not null);
drop policy if exists "bulletins: admin escribe" on public.bulletins;
create policy "bulletins: admin escribe" on public.bulletins
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- FASE QUEEN EXTERNA CON IA (bloque nuevo, idempotente)
-- Estado de Queen como dato: su medición de evolución (etapa,
-- índice y señales) calculada por el núcleo determinista. La
-- memoria de Queen que viaja en el respaldo (conceptos, alias,
-- decisiones) vive en app_settings, como en fases anteriores;
-- esta tabla guarda solo el resumen de evolución. La CONVERSACIÓN
-- no se persiste en el servidor en esta fase (vive en la sesión
-- del dispositivo), igual que la capa de lenguaje: la Edge
-- Function «queen-chat» no necesita tablas (lee su secreto del
-- entorno de la función y valida la sesión del llamante).
-- ============================================================

create table if not exists public.queen_state (
  id text primary key,                        -- 'evolution'
  payload jsonb not null default '{}'::jsonb, -- medición completa de queenCore
  updated_at timestamptz not null default now()
);

alter table public.queen_state enable row level security;

drop policy if exists "queen_state: lectura con rol" on public.queen_state;
create policy "queen_state: lectura con rol" on public.queen_state
  for select using (public.current_role() is not null);
drop policy if exists "queen_state: admin escribe" on public.queen_state;
create policy "queen_state: admin escribe" on public.queen_state
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- FASE PARIDAD DE AUTOMATIZACIONES (bloque nuevo, idempotente)
-- Estado de las tareas programadas: registro de corridas
-- (automation_state fila 'runs') y estado persistente del
-- aprendizaje nocturno (fila 'learning'). Los respaldos diarios
-- van a Supabase Storage (bucket privado 'backups', creado por la
-- Edge Function queen-backup con la clave de servicio; las
-- políticas de Storage se crean junto al despliegue, no aquí).
-- Las tareas se programan con pg_cron llamando a las Edge
-- Functions vía pg_net: ver supabase/automatizaciones-cron.sql
-- (archivo separado, se aplica SOLO tras desplegar las funciones;
-- los secretos se nombran en Vault, nunca se escriben aquí).
-- ============================================================

create table if not exists public.automation_state (
  id text primary key,                        -- 'runs' | 'learning'
  payload jsonb not null default '[]'::jsonb, -- registro de corridas / estado de aprendizaje
  updated_at timestamptz not null default now()
);

alter table public.automation_state enable row level security;

drop policy if exists "automation_state: lectura con rol" on public.automation_state;
create policy "automation_state: lectura con rol" on public.automation_state
  for select using (public.current_role() is not null);
drop policy if exists "automation_state: admin escribe" on public.automation_state;
create policy "automation_state: admin escribe" on public.automation_state
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- FASE PARIDAD TOTAL — MEDIA AUTENTICADA (bloque nuevo,
-- idempotente). Los binarios del sistema original (fotos de
-- productos y de almacén, fotos de trabajadores y de clientes,
-- documentos de trabajadores, foto de perfil, activos del
-- sistema, IPV originales/actualizados y adjuntos/gráficos de
-- boletines) viven SOLO aquí, tras el login: lectura con rol,
-- escritura solo admin, igual que el resto de tablas. NUNCA se
-- publican como archivos estáticos. La carga inicial se genera
-- con scripts/generate-media-sql.mjs desde media-export/
-- (extracción verificada del almacenamiento del original).
-- Contrato de claves (entity_key):
--   foto-producto      slug(departamento + nombre + um) = stem del archivo
--   foto-almacen       slug(nombre del producto)
--   foto-trabajador    slug(nombre del trabajador)
--   documento-trabajador slug(nombre) + variant = carnet-frente |
--                      carnet-reverso | tarjeta-bancaria | titulo
--   foto-cliente       slug(nombre del cliente)
--   foto-perfil        'perfil-admin'
--   activo-sistema     stem del archivo (cuno-la-reina-aprobado, logos)
--   ipv-original / ipv-actualizado  entity_key = fecha, variant = stem
--   adjunto-correo / grafico-correo entity_key = id del boletín
-- ============================================================

create table if not exists public.media (
  id bigint generated always as identity primary key,
  kind text not null,
  entity_key text not null,
  variant text not null default '',
  label text not null,
  mime text not null,
  bytes int not null,
  sha256 text not null,
  data_base64 text not null,
  unique (kind, entity_key, variant)
);

alter table public.media enable row level security;

drop policy if exists "media: lectura con rol" on public.media;
create policy "media: lectura con rol" on public.media
  for select using (public.current_role() is not null);
drop policy if exists "media: admin escribe" on public.media;
create policy "media: admin escribe" on public.media
  for all using (public.is_admin()) with check (public.is_admin());
