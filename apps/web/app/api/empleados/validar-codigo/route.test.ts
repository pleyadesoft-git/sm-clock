import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { GET } from './route';

const mockRequireAuthenticatedUser = vi.fn();
const mockResolveTenantIdForUser = vi.fn();
const mockMaybeSingle = vi.fn();

let capturedQuery: {
  table: string;
  select: string;
  tenantId?: string;
  codigo?: string;
  neqId?: string;
} = { table: '', select: '' };

vi.mock('@/lib/server/auth', () => ({
  requireAuthenticatedUser: () => mockRequireAuthenticatedUser(),
  resolveTenantIdForUser: () => mockResolveTenantIdForUser(),
}));

vi.mock('@/lib/server/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      capturedQuery.table = table;
      return {
        select: (cols: string) => {
          capturedQuery.select = cols;
          return {
            eq: (_field1: string, val1: string) => {
              capturedQuery.tenantId = val1;
              return {
                eq: (_field2: string, val2: string) => {
                  capturedQuery.codigo = val2;
                  const queryObj: {
                    neq: (f: string, v: string) => typeof queryObj;
                    maybeSingle: () => Promise<unknown>;
                  } = {
                    neq: (_field3: string, val3: string) => {
                      capturedQuery.neqId = val3;
                      return queryObj;
                    },
                    maybeSingle: () => mockMaybeSingle(),
                  };
                  return queryObj;
                },
              };
            },
          };
        },
      };
    },
  }),
}));

describe('GET /api/empleados/validar-codigo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedQuery = { table: '', select: '' };
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

  it('rejects unauthenticated requests with 401', async () => {
    mockRequireAuthenticatedUser.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: 'No autenticado',
    });

    const res = await GET(new Request('http://localhost/api/empleados/validar-codigo?codigo=1001'));
    expect(res.status).toBe(401);
  });

  it('rejects OPERADOR role with 403', async () => {
    mockRequireAuthenticatedUser.mockResolvedValueOnce({
      ok: true,
      user: {
        userId: 'op-1',
        rol: 'OPERADOR',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });

    const res = await GET(new Request('http://localhost/api/empleados/validar-codigo?codigo=1001'));
    expect(res.status).toBe(403);
  });

  it('returns 422 if codigo is missing or has invalid characters', async () => {
    const res1 = await GET(new Request('http://localhost/api/empleados/validar-codigo'));
    expect(res1.status).toBe(422);

    const res2 = await GET(new Request('http://localhost/api/empleados/validar-codigo?codigo=bad%20code%20with%20spaces'));
    expect(res2.status).toBe(422);
  });

  it('returns disponible: true when no existing employee has that code', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const res = await GET(new Request('http://localhost/api/empleados/validar-codigo?codigo=EMP-1001'));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      disponible: true,
      codigo: 'EMP-1001',
      empleadoExistente: null,
    });
    expect(capturedQuery.codigo).toBe('EMP-1001');
    expect(capturedQuery.tenantId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('returns disponible: false and details when code is already taken', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        codigo_empleado: 'EMP-1001',
        nombre_completo: 'Carlos Santana',
        estatus_empleado: 'A',
      },
      error: null,
    });

    const res = await GET(new Request('http://localhost/api/empleados/validar-codigo?codigo=EMP-1001'));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      disponible: false,
      codigo: 'EMP-1001',
      empleadoExistente: {
        id: '22222222-2222-4222-8222-222222222222',
        nombre: 'Carlos Santana',
        estatus: 'A',
      },
    });
  });

  it('excludes current employee ID when excludeId is provided', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const excludeId = '33333333-3333-4333-8333-333333333333';
    const res = await GET(
      new Request(`http://localhost/api/empleados/validar-codigo?codigo=EMP-1001&excludeId=${excludeId}`),
    );
    expect(res.status).toBe(200);
    expect(capturedQuery.neqId).toBe(excludeId);
  });
});
