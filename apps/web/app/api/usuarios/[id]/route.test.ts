import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { DELETE } from './route';

const mockRequireTenantAdmin = vi.fn();
const mockRecordAuditLog = vi.fn();
const mockUpdateUserById = vi.fn();
const mockPerfilMaybeSingle = vi.fn();
const mockInviteMaybeSingle = vi.fn();

vi.mock('@/lib/server/auth', () => ({
  requireTenantAdmin: () => mockRequireTenantAdmin(),
  recordAuditLog: (...args: unknown[]) => mockRecordAuditLog(...args),
}));

vi.mock('@/lib/server/supabase-admin', () => ({
  createSupabaseServiceClient: () => ({
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => mockUpdateUserById(...args),
      },
    },
    from: (table: string) => {
      if (table === 'perfiles_usuarios') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: mockPerfilMaybeSingle,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'invitaciones_usuarios') {
        return {
          delete: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: mockInviteMaybeSingle,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

describe('DELETE /api/usuarios/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireTenantAdmin.mockResolvedValue({
      ok: true,
      tenantId: '11111111-1111-4111-8111-111111111111',
      user: {
        userId: 'admin-self-id',
        email: 'admin@empresa.mx',
        rol: 'ADMIN_EMPRESA',
        tenantId: '11111111-1111-4111-8111-111111111111',
        aal: 'aal2',
      },
    });
  });

  it('rejects self-deletion with 400', async () => {
    const res = await DELETE(new Request('http://localhost/api/usuarios/admin-self-id', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'admin-self-id' }),
    });
    expect(res.status).toBe(400);
    expect(mockPerfilMaybeSingle).not.toHaveBeenCalled();
  });

  it('soft-deletes an active tenant user and bans auth login', async () => {
    mockPerfilMaybeSingle.mockResolvedValue({
      data: { id: 'user-2', email: 'op@empresa.mx', nombre_completo: 'Operador' },
      error: null,
    });

    const res = await DELETE(new Request('http://localhost/api/usuarios/user-2', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'user-2' }),
    });

    expect(res.status).toBe(200);
    expect(mockUpdateUserById).toHaveBeenCalledWith('user-2', {
      ban_duration: '876000h',
    });
    expect(mockRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'ELIMINAR_USUARIO_TENANT',
      }),
    );
  });

  it('deletes an invitation when no user profile matches the id', async () => {
    mockPerfilMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInviteMaybeSingle.mockResolvedValue({
      data: { id: 'inv-1', email: 'nuevo@empresa.mx' },
      error: null,
    });

    const res = await DELETE(new Request('http://localhost/api/usuarios/inv-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'inv-1' }),
    });

    expect(res.status).toBe(200);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'ELIMINAR_INVITACION',
      }),
    );
  });

  it('returns 404 when neither user nor invitation exists', async () => {
    mockPerfilMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInviteMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await DELETE(new Request('http://localhost/api/usuarios/missing', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(res.status).toBe(404);
  });
});
