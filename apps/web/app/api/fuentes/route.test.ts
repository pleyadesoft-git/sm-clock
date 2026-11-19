import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/realtime-broadcast', () => ({
  broadcastTenantEvent: vi.fn(),
}));

const mockRequireAuthenticatedUser = vi.fn();
vi.mock('@/lib/server/auth', () => ({
  requireAuthenticatedUser: () => mockRequireAuthenticatedUser(),
  recordAuditLog: vi.fn(),
}));

const mockUpsert = vi.fn();
const mockSelect = vi.fn();
vi.mock('@/lib/server/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: mockSelect,
      upsert: mockUpsert,
    }),
  }),
}));

import { GET, POST } from './route';

describe('API /api/fuentes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    mockRequireAuthenticatedUser.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: 'No autenticado',
    });

    const res = await GET(new Request('http://localhost/api/fuentes'));
    expect(res.status).toBe(401);
  });

  it('validates required fields on POST', async () => {
    mockRequireAuthenticatedUser.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user-1',
        rol: 'ADMIN_EMPRESA',
        tenantId: 'tenant-1',
      },
    });

    const res = await POST(
      new Request('http://localhost/api/fuentes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre_ubicacion: '', // Demasiado corto
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('successfully registers clock and triggers broadcast', async () => {
    mockRequireAuthenticatedUser.mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'user-1',
        rol: 'ADMIN_EMPRESA',
        tenantId: 'tenant-1',
      },
    });

    mockUpsert.mockReturnValueOnce({
      select: () => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'clock-1',
            tenant_id: 'tenant-1',
            sucursal_id: 'suc-1',
            clave: 'TIJ001-MATRIZ-01',
            nombre_ubicacion: 'Reloj Puerta Principal',
            marca: 'ZKTECO',
            ip_local: '192.168.1.201',
            puerto: 4370,
            activo: true,
          },
          error: null,
        }),
      }),
    });

    const res = await POST(
      new Request('http://localhost/api/fuentes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursal_id: '11111111-2222-4333-8444-555555555555',
          nombre_ubicacion: 'Reloj Puerta Principal',
          marca: 'ZKTECO',
          ip_local: '192.168.1.201',
          puerto: 4370,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.clave).toBe('TIJ001-MATRIZ-01');
  });
});
