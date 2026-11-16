import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { PATCH } from './route';

const mockRequireAuthenticatedUser = vi.fn();
const mockResolveTenantIdForUser = vi.fn();
const mockRecordAuditLog = vi.fn();
const mockUpdateSingle = vi.fn();

vi.mock('@/lib/server/auth', () => ({
  requireAuthenticatedUser: () => mockRequireAuthenticatedUser(),
  resolveTenantIdForUser: () => mockResolveTenantIdForUser(),
  recordAuditLog: (...args: unknown[]) => mockRecordAuditLog(...args),
}));

vi.mock('@/lib/server/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'empleados') {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: () => mockUpdateSingle(payload),
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

describe('PATCH /api/empleados — Inhabilitar / Editar empleado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthenticatedUser.mockResolvedValue({
      ok: true,
      user: {
        userId: 'admin-1',
        rol: 'ADMIN_EMPRESA',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });
    mockResolveTenantIdForUser.mockResolvedValue('11111111-1111-4111-8111-111111111111');
  });

  it('rejects update for OPERADOR role with 403', async () => {
    mockRequireAuthenticatedUser.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: 'op-1',
        rol: 'OPERADOR',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });

    const res = await PATCH(
      new Request('http://localhost/api/empleados', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '22222222-2222-4222-8222-222222222222',
          estatus_empleado: 'I',
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(mockUpdateSingle).not.toHaveBeenCalled();
  });

  it('allows partial update to inhabilitar employee without sending all fields', async () => {
    const employeeId = '22222222-2222-4222-8222-222222222222';
    mockUpdateSingle.mockImplementation((payload: Record<string, unknown>) =>
      Promise.resolve({
        data: {
          id: employeeId,
          codigo_empleado: '1001',
          nombre_completo: 'Carlos Santana',
          estatus_empleado: payload.estatus_empleado,
        },
        error: null,
      }),
    );

    const res = await PATCH(
      new Request('http://localhost/api/empleados', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: employeeId,
          estatus_empleado: 'I',
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockUpdateSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        estatus_empleado: 'I',
      }),
    );
    expect(mockRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'ACTUALIZAR_EMPLEADO',
      }),
    );
  });
});
