-- ============================================================
-- AUTOMATIZACIONES — programación con pg_cron + pg_net.
--
-- Archivo SEPARADO del esquema a propósito: se aplica SOLO en la
-- puerta final, DESPUÉS de desplegar las Edge Functions
-- (queen-backup, queen-maintenance, queen-bulletins) y de crear
-- los secretos. Nada de esto está aplicado en el proyecto real.
--
-- Requisitos (panel de Supabase):
--   1. Extensiones pg_cron y pg_net activadas (Database →
--      Extensions).
--   2. Secretos en Vault (Database → Vault), creados por el dueño:
--        functions_base_url = https://<ref>.supabase.co/functions/v1
--        cron_secret        = el mismo valor del secreto
--                             CRON_SECRET de las Edge Functions.
--      Los valores NO se escriben en este archivo: se leen de
--      Vault en cada llamada.
--   3. Secreto de las funciones: CRON_SECRET (y, para boletines,
--      RESEND_API_KEY y BULLETIN_FROM si se conecta Resend).
--
-- Horarios: pg_cron trabaja en UTC. La Habana es UTC-4 con horario
-- de verano y UTC-5 en invierno; los horarios de abajo están
-- puestos para UTC-4 (verano). En invierno hay que moverlos una
-- hora (05:45 / 08:45 / 03:35 UTC) — queda anotado para la puerta
-- final: es la diferencia honesta frente al runtime del original,
-- que programaba en hora local.
--   Respaldo 23:45 Habana      → 03:45 UTC del día siguiente
--   Mantenimiento 03:45 Habana → 07:45 UTC
--   Aprendizaje tras el mantenimiento → 08:05 UTC
--   Aviso IPV 22:30 Habana     → 02:30 UTC del día siguiente
--   Boletines: cada 10 minutos (sin zona horaria)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reprogramar sin duplicar: si el trabajo ya existe, se retira.
do $$
begin
  perform cron.unschedule('queen-backup-2345');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('queen-mantenimiento-0345');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('queen-aprendizaje-nocturno');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('queen-aviso-ipv-2230');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('queen-boletines-10min');
exception when others then null;
end $$;

select cron.schedule(
  'queen-backup-2345',
  '45 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/queen-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'queen-mantenimiento-0345',
  '45 7 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/queen-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"task":"mantenimiento"}'::jsonb
  );
  $$
);

select cron.schedule(
  'queen-aprendizaje-nocturno',
  '5 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/queen-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"task":"aprendizaje"}'::jsonb
  );
  $$
);

select cron.schedule(
  'queen-aviso-ipv-2230',
  '30 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/queen-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"task":"aviso-ipv"}'::jsonb
  );
  $$
);

select cron.schedule(
  'queen-boletines-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/queen-bulletins',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
