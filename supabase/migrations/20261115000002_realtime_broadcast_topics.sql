-- =========================================================================
-- EXPANDIR AUTORIZACIÓN DE CANALES PRIVADOS SUPABASE REALTIME
-- Permite canales por tenant (tenant:<id>, tenant:<id>:*, etc.) y admin:events para SUPER_ADMIN
-- =========================================================================

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'realtime'
      and table_name = 'messages'
  ) then
    drop policy if exists realtime_tenant_checadas on realtime.messages;
    drop policy if exists realtime_tenant_broadcast on realtime.messages;

    execute $pol$
      create policy realtime_tenant_broadcast on realtime.messages
        for select to authenticated
        using (
          realtime.messages.extension = 'broadcast'
          and (
            (select public.current_user_rol()) = 'SUPER_ADMIN'
            or realtime.topic() = 'tenant:' || (select public.current_tenant_id())::text
            or realtime.topic() like 'tenant:' || (select public.current_tenant_id())::text || ':%'
          )
        )
    $pol$;
  end if;
end
$$;
