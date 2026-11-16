-- Soft delete para perfiles_usuarios
alter table public.perfiles_usuarios
  add column if not exists deleted_at timestamptz;

create index if not exists idx_perfiles_usuarios_active
  on public.perfiles_usuarios (tenant_id)
  where deleted_at is null;
