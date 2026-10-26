-- Queen SDA — Biometría WebAuthn de esta copia (AÑADIDO DEL DUEÑO,
-- decisión del 2026-10-26). NO forma parte del esquema de paridad:
-- son las tablas de la Edge Function queen-webauthn.
--
-- SIN APLICAR todavía: lo aplica Lórien por el panel de Supabase
-- junto con el despliegue de la función. El archivo es IDEMPOTENTE
-- (create table/index if not exists; drop policy if exists antes
-- de cada create policy): se puede pegar entero en el SQL Editor
-- y repetirlo sin fallar ni tocar datos.
--
-- Diseño:
-- - webauthn_credentials: una fila por credencial registrada
--   (usuario × dispositivo). Solo se guarda el id de la credencial
--   y su CLAVE PÚBLICA (COSE en base64url): nada biométrico sale
--   jamás del dispositivo, y la clave pública no es un secreto.
-- - webauthn_challenges: retos de un solo uso y vida corta que
--   emite la función. Sin políticas para anon/authenticated: la
--   tabla solo la toca la función con la clave de servicio.
-- - RLS en credenciales: cada usuario lee y borra SOLO las suyas
--   (la app lista y borra desde Ajustes); no hay política de
--   inserción/actualización para authenticated porque escribir y
--   actualizar contador/último uso es trabajo exclusivo de la
--   función (service role, que salta la RLS).

create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists webauthn_credentials_user_idx
  on public.webauthn_credentials (user_id);

create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  challenge text not null,
  purpose text not null check (purpose in ('register', 'auth')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists webauthn_challenges_user_idx
  on public.webauthn_challenges (user_id, purpose, created_at desc);

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;

drop policy if exists "webauthn_credentials: leer las propias" on public.webauthn_credentials;
create policy "webauthn_credentials: leer las propias" on public.webauthn_credentials
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "webauthn_credentials: borrar las propias" on public.webauthn_credentials;
create policy "webauthn_credentials: borrar las propias" on public.webauthn_credentials
  for delete to authenticated
  using (auth.uid() = user_id);

-- webauthn_challenges: sin políticas a propósito. Con RLS activo y
-- ninguna política, anon/authenticated no pueden ni leer ni
-- escribir; la función (service role) es la única vía.
