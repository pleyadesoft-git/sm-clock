import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

const mockGetUser = vi.fn();
const mockGetAal = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
      mfa: {
        getAuthenticatorAssuranceLevel: mockGetAal,
      },
    },
  }),
}));

describe('proxy (Middleware Routing Guard & CSRF Isolation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://example.supabase.co';
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon-key-test';
  });

  it('rejects cross-site mutating API requests via Sec-Fetch-Site header (CSRF protection)', async () => {
    const req = new NextRequest('https://smclock.mx/api/empleados', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'cross-site',
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it('allows cross-site POST to /api/v1/agente/* (HMAC-authenticated local agent)', async () => {
    const req = new NextRequest('https://smclock.mx/api/v1/agente/latido', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'cross-site',
      },
    });

    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it('redirects unauthenticated browser requests on protected routes to /login?next=...', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const req = new NextRequest('https://smclock.mx/empleados?page=2');
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://smclock.mx/login?next=%2Fempleados%3Fpage%3D2',
    );
  });

  it('returns 401 JSON for unauthenticated /api/* requests', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const req = new NextRequest('https://smclock.mx/api/empleados');
    const res = await proxy(req);

    expect(res.status).toBe(401);
  });

  it('redirects authenticated user on /login to their safe destination', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          app_metadata: {
            rol: 'ADMIN_EMPRESA',
            tenant_id: '550e8400-e29b-41d4-a716-446655440000',
          },
        },
      },
    });
    mockGetAal.mockResolvedValueOnce({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    });

    const req = new NextRequest(
      'https://smclock.mx/login?next=https://evil.com',
    );
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://smclock.mx/dashboard');
  });

  it('preserves public reverse-proxy origin (x-forwarded-host) when redirecting from internal port', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          app_metadata: {
            rol: 'SUPER_ADMIN',
            tenant_id: null,
          },
        },
      },
    });
    mockGetAal.mockResolvedValueOnce({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    });

    const req = new NextRequest('http://localhost:3008/login', {
      headers: {
        'x-forwarded-host': 'sm-clock.pleyadesoft.com',
        'x-forwarded-proto': 'https',
      },
    });
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://sm-clock.pleyadesoft.com/admin/empresas',
    );
  });

  it('enforces MFA (aal2) for ADMIN_EMPRESA and SUPER_ADMIN before accessing protected routes', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '550e8400-e29b-41d4-a716-446655440002',
          app_metadata: { rol: 'SUPER_ADMIN', tenant_id: null },
        },
      },
    });
    mockGetAal.mockResolvedValueOnce({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });

    const req = new NextRequest('https://smclock.mx/admin/empresas');
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://smclock.mx/mfa?next=%2Fadmin%2Fempresas',
    );
  });

  it('blocks OPERADOR from accessing /usuarios or /empleados and redirects to /dashboard', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '550e8400-e29b-41d4-a716-446655440003',
          app_metadata: {
            rol: 'OPERADOR',
            tenant_id: '550e8400-e29b-41d4-a716-446655440000',
          },
        },
      },
    });

    const req = new NextRequest('https://smclock.mx/usuarios');
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://smclock.mx/dashboard');
  });

  it('blocks ADMIN_EMPRESA from accessing /admin/empresas and redirects to /dashboard', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          app_metadata: {
            rol: 'ADMIN_EMPRESA',
            tenant_id: '550e8400-e29b-41d4-a716-446655440000',
          },
        },
      },
    });
    mockGetAal.mockResolvedValueOnce({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    });

    const req = new NextRequest('https://smclock.mx/admin/empresas');
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://smclock.mx/dashboard');
  });
});
