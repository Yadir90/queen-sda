-- Queen SDA — Sistema de Automatización de Datos V2.0
-- Esquema para Supabase (Postgres). APLICADO el 2026-10-25 en el proyecto
-- «queen-sda» del dueño (las 5 tablas existen y RLS está activo).
-- Roles: 'admin' (escribe) y 'lectura' (solo lee), replicando la fase 1.
-- RLS activo en todas las tablas: lectura para ambos roles, escritura solo admin.

create type public.app_role as enum ('admin', 'lectura');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
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
create table public.days (
  date date primary key,
  ventas_dia numeric not null default 0,
  ganancia_bruta numeric not null default 0,
  ganancia_neta numeric not null default 0,
  cuadre numeric not null default 0,
  payload jsonb not null default '{}'::jsonb, -- día completo tal como entró (departamentos, fondos, RH)
  imported_at timestamptz not null default now()
);

-- Cuentas por cobrar.
create table public.receivables (
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
create index receivables_client_key_idx on public.receivables (client_key);
create index receivables_category_idx on public.receivables (category);

-- Abonos (pagos) sobre cuentas: los del respaldo y los registrados en Cobrar.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id text not null references public.receivables (id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_date date not null,
  payment_method text not null check (payment_method in ('efectivo', 'transferencia')),
  origin text not null default 'cobrar',  -- 'respaldo' | 'cobrar'
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index payments_receivable_idx on public.payments (receivable_id);

-- RLS: lectura para cualquier usuario autenticado con rol; escritura solo admin.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.days enable row level security;
alter table public.receivables enable row level security;
alter table public.payments enable row level security;

create policy "profiles: leer el propio" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles: admin escribe" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

create policy "user_roles: leer el propio" on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin());
create policy "user_roles: admin escribe" on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

create policy "days: lectura con rol" on public.days
  for select using (public.current_role() is not null);
create policy "days: admin escribe" on public.days
  for all using (public.is_admin()) with check (public.is_admin());

create policy "receivables: lectura con rol" on public.receivables
  for select using (public.current_role() is not null);
create policy "receivables: admin escribe" on public.receivables
  for all using (public.is_admin()) with check (public.is_admin());

create policy "payments: lectura con rol" on public.payments
  for select using (public.current_role() is not null);
create policy "payments: admin escribe" on public.payments
  for insert with check (public.is_admin());
