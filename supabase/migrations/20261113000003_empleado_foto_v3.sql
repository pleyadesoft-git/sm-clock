-- =========================================================================
-- MIGRACIÓN: 20261113000003_empleado_foto_v3.sql
-- Propósito: Columnas de fotografía en empleados, bucket privado
--            `empleados-fotos` en Supabase Storage y políticas RLS por tenant.
-- =========================================================================

-- 1. Columnas en public.empleados
alter table public.empleados
  add column if not exists foto_path text,
  add column if not exists foto_thumb_path text,
  add column if not exists foto_actualizada_en timestamptz;

-- 2. Bucket privado `empleados-fotos` (máximo 512 KB, solo WebP y JPEG)
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'empleados-fotos',
      'empleados-fotos',
      false,
      524288,
      array['image/webp', 'image/jpeg']
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = 524288,
          allowed_mime_types = array['image/webp', 'image/jpeg'];
  end if;
end
$$;

-- 3. Políticas RLS en storage.objects para lectura aislada por tenant
--    (Sin políticas de INSERT/UPDATE/DELETE para authenticated: solo service_role escribe)
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'objects'
  ) then
    drop policy if exists fotos_select on storage.objects;
    execute $pol$
      create policy fotos_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'empleados-fotos'
          and (
            (select public.current_user_rol()) = 'SUPER_ADMIN'
            or (storage.foldername(name))[1] = (select public.current_tenant_id())::text
          )
        )
    $pol$;
  end if;
end
$$;
