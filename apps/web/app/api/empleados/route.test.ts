import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { PATCH, POST } from './route';

const mockRequireAuthenticatedUser = vi.fn();
const mockResolveTenantIdForUser = vi.fn();
const mockRecordAuditLog = vi.fn();
const mockUpdateSingle = vi.fn();
const mockInsertSingle = vi.fn();
const mockSelectMaybeSingle = vi.fn();

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
          select: () => ({
            eq: () => ({
              eq: () => {
                const queryObj: {
                  neq: () => typeof queryObj;
                  maybeSingle: () => Promise<unknown>;
                } = {
                  neq: () => queryObj,
                  maybeSingle: () => mockSelectMaybeSingle(),
                };
                return queryObj;
              },
            }),
          }),
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: () => mockInsertSingle(payload),
            }),
          }),
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

describe('POST /api/empleados — Alta de empleado y validación de código', () => {
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

  it('rejects POST with 409 if employee code is already taken', async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        nombre_completo: 'Empleado Existente',
      },
      error: null,
    });

    const res = await POST(
      new Request('http://localhost/api/empleados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo_empleado: '1001',
          nombre_completo: 'Nuevo Empleado',
          estatus_empleado: 'A',
        }),
      }),
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('ya está registrado por Empleado Existente');
    expect(mockInsertSingle).not.toHaveBeenCalled();
  });

  it('creates employee successfully when code is available', async () => {
    mockSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    mockInsertSingle.mockResolvedValueOnce({
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        codigo_empleado: '1001',
        nombre_completo: 'Nuevo Empleado',
        estatus_empleado: 'A',
      },
      error: null,
    });

    const res = await POST(
      new Request('http://localhost/api/empleados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo_empleado: '1001',
          nombre_completo: 'Nuevo Empleado',
          estatus_empleado: 'A',
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(mockInsertSingle).toHaveBeenCalled();
  });
});

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
