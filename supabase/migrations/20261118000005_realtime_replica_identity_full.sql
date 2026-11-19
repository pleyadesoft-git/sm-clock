-- =========================================================================
-- MIGRACIÓN: 20261118000005_realtime_replica_identity_full.sql
-- Propósito: Configurar REPLICA IDENTITY FULL en las tablas que emiten
-- eventos a Supabase Realtime (empleados, checadas, sucursales, usuarios).
--
-- Por defecto en PostgreSQL, REPLICA IDENTITY es DEFAULT (solo envía la PK).
-- Para que los eventos de UPDATE y DELETE contengan todas las columnas
-- (incluyendo tenant_id) y no se descarten en los canales filtrados por tenant,
-- se requiere REPLICA IDENTITY FULL.
-- =========================================================================

alter table public.empleados replica identity full;
alter table public.checadas replica identity full;
alter table public.sucursales replica identity full;
alter table public.perfiles_usuarios replica identity full;
alter table public.invitaciones_usuarios replica identity full;
