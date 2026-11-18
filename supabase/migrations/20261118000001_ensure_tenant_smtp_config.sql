-- =========================================================================
-- MIGRACIÓN 20261118000001: GARANTIZAR CONFIGURACIÓN SMTP POR CADA TENANT
-- =========================================================================

-- 1. Insertar configuración SMTP predeterminada para cualquier tenant existente que no cuente con una
insert into public.configuracion_smtp (
  tenant_id,
  usar_smtp_propio,
  host,
  puerto,
  seguridad,
  usuario,
  remitente_email,
  remitente_nombre,
  activo
)
select
  t.id,
  false,
  'smtp.gmail.com',
  465,
  'TLS',
  '',
  'notificaciones@smclock.mx',
  coalesce(t.nombre_comercial, t.razon_social, 'SM Clock') || ' · Notificaciones',
  true
from public.tenants t
where not exists (
  select 1 from public.configuracion_smtp s where s.tenant_id = t.id
)
on conflict (tenant_id) do nothing;
