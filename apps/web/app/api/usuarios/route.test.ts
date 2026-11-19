import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { GET } from './route';

const mockRequireTenantAdmin = vi.fn();
const mockPerfilesOrder = vi.fn();
const mockInvitacionesOrder = vi.fn();

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server/smtp-mailer', () => ({
  buildInvitationEmailTemplate: vi.fn(),
  sendTenantEmail: vi.fn(),
}));

vi.mock('@/lib/server/auth', () => ({
  requireTenantAdmin: () => mockRequireTenantAdmin(),
  recordAuditLog: vi.fn(),
}));

vi.mock('@/lib/server/supabase-admin', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (table === 'perfiles_usuarios') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: mockPerfilesOrder,
              }),
            }),
          }),
        };
      }
      if (table === 'invitaciones_usuarios') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                order: mockInvitacionesOrder,
              }),
            }),
          }),
        };
      }
      if (table === 'sucursales') {
        return {
          select: () => ({
            eq: () => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

describe('GET /api/usuarios — Email uniqueness deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireTenantAdmin.mockResolvedValue({
      ok: true,
      tenantId: '11111111-1111-4111-8111-111111111111',
      user: {
        userId: '00000000-0000-4000-8000-000000000001',
        email: 'admin@empresa.mx',
        rol: 'ADMIN_EMPRESA',
        tenantId: '11111111-1111-4111-8111-111111111111',
        aal: 'aal2',
      },
    });
  });

  it('returns only one row per unique email even when multiple invitations exist', async () => {
    const futureIso = new Date(Date.now() + 86_400_000).toISOString();
    mockPerfilesOrder.mockResolvedValue({
      data: [
        {
          id: 'u-1',
          nombre_completo: 'Admin Empresa',
          email: 'admin@empresa.mx',
          rol: 'ADMIN_EMPRESA',
          activo: true,
          auth_provider: 'GOOGLE',
          created_at: '2026-11-10T10:00:00.000Z',
        },
      ],
      error: null,
    });

    mockInvitacionesOrder.mockResolvedValue({
      data: [
        {
          id: 'inv-3',
          nombre_completo: 'Juan Pérez (Nuevo)',
          email: 'Juan@Empresa.mx',
          rol: 'OPERADOR',
          estatus: 'PENDIENTE',
          expira_en: futureIso,
          created_at: '2026-11-15T12:00:00.000Z',
        },
        {
          id: 'inv-2',
          nombre_completo: 'Juan Pérez',
          email: 'juan@empresa.mx',
          rol: 'OPERADOR',
          estatus: 'REVOCADA',
          expira_en: futureIso,
          created_at: '2026-11-14T12:00:00.000Z',
        },
        {
          id: 'inv-1',
          nombre_completo: 'Admin Empresa',
          email: 'admin@empresa.mx',
          rol: 'ADMIN_EMPRESA',
          estatus: 'REVOCADA',
          expira_en: futureIso,
          created_at: '2026-11-09T12:00:00.000Z',
        },
      ],
      error: null,
    });

    const req = new Request('http://localhost:3000/api/usuarios');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      data: Array<{ id: string; email: string; estatus: string }>;
      total: number;
    };

    expect(json.total).toBe(2);
    expect(json.data).toHaveLength(2);
    expect(json.data.map((r) => r.email.toLowerCase())).toEqual([
      'admin@empresa.mx',
      'juan@empresa.mx',
    ]);
    expect(json.data[1]?.id).toBe('inv-3');
    expect(json.data[1]?.estatus).toBe('PENDIENTE');
  });
});
