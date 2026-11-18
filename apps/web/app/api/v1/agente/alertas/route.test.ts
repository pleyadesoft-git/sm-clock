import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockSendTenantEmail = vi.fn().mockResolvedValue({
  delivered: true,
  simulated: false,
  provider: 'GOOGLE_DEFAULT',
});

vi.mock('@/lib/server/smtp-mailer', () => ({
  sendTenantEmail: (...args: unknown[]) => mockSendTenantEmail(...args),
  buildAgentErrorReportEmailTemplate: vi.fn().mockReturnValue({
    subject: '🚨 Alerta de Error en Agente Local: [Empresa Test] FALLO_RELOJ',
    html: '<p>Error detectado</p>',
    text: 'Error detectado',
  }),
}));

const mockBroadcastTenantEvent = vi.fn().mockResolvedValue(undefined);
const mockBroadcastAdminEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/server/realtime-broadcast', () => ({
  broadcastTenantEvent: (...args: unknown[]) => mockBroadcastTenantEvent(...args),
  broadcastAdminEvent: (...args: unknown[]) => mockBroadcastAdminEvent(...args),
}));

const mockAuthenticateAgentRequest = vi.fn();
vi.mock('@/lib/server/agent-auth', () => ({
  authenticateAgentRequest: (...args: unknown[]) =>
    mockAuthenticateAgentRequest(...args),
}));

const mockRequireTenantAdmin = vi.fn();
vi.mock('@/lib/server/auth', () => ({
  requireTenantAdmin: () => mockRequireTenantAdmin(),
  getBootstrapSuperAdminEmails: () => ['superadmin@smclock.mx'],
}));

const mockFrom = vi.fn();
vi.mock('@/lib/server/supabase-admin', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => mockFrom(table),
  }),
}));

import { POST } from './route';

describe('POST /api/v1/agente/alertas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    mockRequireTenantAdmin.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: 'No autenticado',
    });

    const req = new Request('http://localhost:3000/api/v1/agente/alertas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo_error: 'FALLO_RELOJ',
        mensaje: 'Sin conexión',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects malformed payloads with 422', async () => {
    mockAuthenticateAgentRequest.mockResolvedValueOnce({
      ok: true,
      agent: {
        agenteId: 'a1111111-1111-1111-1111-111111111111',
        tenantId: 't1111111-1111-1111-1111-111111111111',
        nombre: 'Agente Tijuana 01',
      },
    });

    const req = new Request('http://localhost:3000/api/v1/agente/alertas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-id': 'a1111111-1111-1111-1111-111111111111',
      },
      body: JSON.stringify({
        // Faltan tipo_error y mensaje
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('sends SMTP emails to Super-Admins and Tenant Admins when agent reports an error', async () => {
    const tenantId = 't1111111-1111-1111-1111-111111111111';
    const agenteId = 'a1111111-1111-1111-1111-111111111111';

    mockAuthenticateAgentRequest.mockResolvedValueOnce({
      ok: true,
      agent: {
        agenteId,
        tenantId,
        nombre: 'Agente Tijuana 01',
      },
    });

    // Mock base de datos: tenants, perfiles_usuarios, auditoria
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { nombre: 'Maquiladora Frontera S.A.' },
              }),
            }),
          }),
        };
      }
      if (table === 'perfiles_usuarios') {
        return {
          select: vi.fn().mockImplementation((_fields: string) => {
            return {
              eq: vi.fn().mockImplementation((col1: string, val1: unknown) => {
                if (col1 === 'rol' && val1 === 'SUPER_ADMIN') {
                  return {
                    eq: vi.fn().mockResolvedValue({
                      data: [{ email: 'admin.plataforma@smclock.mx' }],
                    }),
                  };
                }
                if (col1 === 'tenant_id') {
                  return {
                    eq: vi.fn().mockReturnValue({
                      eq: vi.fn().mockResolvedValue({
                        data: [{ email: 'admin.empresa@frontera.com' }],
                      }),
                    }),
                  };
                }
                return { eq: vi.fn().mockResolvedValue({ data: [] }) };
              }),
            };
          }),
        };
      }
      if (table === 'auditoria') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    const req = new Request('http://localhost:3000/api/v1/agente/alertas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-id': agenteId,
      },
      body: JSON.stringify({
        tipo_error: 'FALLO_CONEXION_RELOJ',
        mensaje: 'Socket timeout al conectar a ZKTeco 192.168.1.201:4370',
        dispositivo: 'ZKTeco Entrada Principal',
        detalle: 'ConnectionRefusedError: [Errno 61] Connection refused',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.notificados).toBeGreaterThanOrEqual(2);
    expect(json.recipientes).toContain('admin.empresa@frontera.com');
    expect(json.recipientes).toContain('admin.plataforma@smclock.mx');

    // Debe haber llamado a sendTenantEmail para cada destinatario
    expect(mockSendTenantEmail).toHaveBeenCalled();
    const calls = mockSendTenantEmail.mock.calls;
    const sentTo = calls.map((c) => (c[0] as { to: string }).to);
    expect(sentTo).toContain('admin.empresa@frontera.com');
    expect(sentTo).toContain('admin.plataforma@smclock.mx');

    // Debe emitir broadcast en tiempo real
    expect(mockBroadcastTenantEvent).toHaveBeenCalledWith(
      tenantId,
      'agentes_changed',
      expect.anything(),
    );
    expect(mockBroadcastAdminEvent).toHaveBeenCalledWith(
      'agentes_changed',
      expect.anything(),
    );
  });
});
