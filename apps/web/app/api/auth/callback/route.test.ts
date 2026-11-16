import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mockExchangeCodeForSession = vi.fn();
const mockGetAuthenticatorAssuranceLevel = vi.fn();
const mockAdminFrom = vi.fn();
const mockAdminAuthUpdateUserById = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      mfa: {
        getAuthenticatorAssuranceLevel: mockGetAuthenticatorAssuranceLevel,
      },
      signOut: vi.fn(),
    },
  }),
}));

vi.mock('@/lib/server/supabase-admin', () => ({
  createSupabaseServiceClient: () => ({
    from: mockAdminFrom,
    auth: {
      admin: {
        updateUserById: mockAdminAuthUpdateUserById,
      },
    },
  }),
}));

vi.mock('@/lib/server/auth', () => ({
  claimBootstrapSuperAdminForUser: vi.fn(),
  claimPendingInvitationForUser: vi.fn(),
  isBootstrapSuperAdminEmail: vi.fn().mockReturnValue(false),
  recordAuditLog: vi.fn(),
}));

import { GET } from './route';

describe('GET /api/auth/callback (Desktop OAuth Relay)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    });
  });

  it('redirects to desktop target with tokens when source=desktop and session is valid', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: { id: 'usr-123', email: 'admin@empresa.com', app_metadata: { rol: 'ADMIN_EMPRESA' } },
        session: {
          access_token: 'fake-access-token',
          refresh_token: 'fake-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
        },
      },
      error: null,
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'perfiles_usuarios') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'usr-123',
                  rol: 'ADMIN_EMPRESA',
                  tenant_id: 'ten-abc',
                  activo: true,
                  nombre_completo: 'Admin Test',
                },
              }),
            }),
          }),
          update: () => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    const request = new Request(
      'http://localhost:3000/api/auth/callback?code=valid-code&source=desktop&target=http%3A%2F%2Flocalhost%3A5173',
    );

    const response = await GET(request);
    expect(response.status).toBe(307);

    const location = response.headers.get('location');
    expect(location).toBeDefined();
    expect(location).toContain('http://localhost:5173');
    expect(location).toContain('access_token=fake-access-token');
    expect(location).toContain('refresh_token=fake-refresh-token');
  });

  it('returns HTML bridge for native custom scheme sm-clock://', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: { id: 'usr-456', email: 'admin@empresa.com', app_metadata: { rol: 'ADMIN_EMPRESA' } },
        session: {
          access_token: 'electron-access-token',
          refresh_token: 'electron-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
        },
      },
      error: null,
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'perfiles_usuarios') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'usr-456',
                  rol: 'ADMIN_EMPRESA',
                  tenant_id: 'ten-abc',
                  activo: true,
                  nombre_completo: 'Admin Test',
                },
              }),
            }),
          }),
          update: () => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {};
    });

    const request = new Request(
      'http://localhost:3000/api/auth/callback?code=valid-code&source=desktop&target=sm-clock%3A%2F%2Fauth%2Fcallback',
    );

    const response = await GET(request);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('sm-clock://auth/callback#access_token=electron-access-token');
    expect(html).toContain('Abrir SM Clock en el escritorio');
  });

  it('redirects to desktop target with error parameter if code exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error('Exchange failed'),
    });

    const request = new Request(
      'http://localhost:3000/api/auth/callback?code=bad-code&source=desktop&target=http%3A%2F%2Flocalhost%3A5173',
    );

    const response = await GET(request);
    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toBe('http://localhost:5173/?error=oauth_invalido');
  });
});
