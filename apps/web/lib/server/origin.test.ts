import { describe, expect, it } from 'vitest';
import { getRequestOrigin } from './origin';

describe('getRequestOrigin (Canonical public host resolution)', () => {
  it('extracts origin from x-forwarded-host and x-forwarded-proto (Reverse Proxy)', () => {
    const req = new Request('http://localhost:3008/api/auth/callback', {
      headers: {
        'x-forwarded-host': 'sm-clock.pleyadesoft.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(getRequestOrigin(req)).toBe('https://sm-clock.pleyadesoft.com');
  });

  it('handles multi-value x-forwarded-host and x-forwarded-proto safely', () => {
    const req = new Request('http://127.0.0.1:3000/api/auth/callback', {
      headers: {
        'x-forwarded-host': 'sm-clock.pleyadesoft.com, proxy.local',
        'x-forwarded-proto': 'https, http',
      },
    });

    expect(getRequestOrigin(req)).toBe('https://sm-clock.pleyadesoft.com');
  });

  it('uses standard host header if not localhost or loopback', () => {
    const req = new Request('http://localhost:3008/api/auth/callback', {
      headers: {
        host: 'sm-clock.pleyadesoft.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(getRequestOrigin(req)).toBe('https://sm-clock.pleyadesoft.com');
  });

  it('falls back to APP_DOMAIN env when request is from local reverse proxy without forwarded headers', () => {
    process.env['APP_DOMAIN'] = 'sm-clock.pleyadesoft.com';
    const req = new Request('http://localhost:3008/api/auth/callback');

    expect(getRequestOrigin(req)).toBe('https://sm-clock.pleyadesoft.com');
    delete process.env['APP_DOMAIN'];
  });

  it('falls back to request.url origin for local development', () => {
    delete process.env['APP_DOMAIN'];
    delete process.env['NEXT_PUBLIC_APP_URL'];
    delete process.env['NEXT_PUBLIC_SITE_URL'];
    const req = new Request('http://localhost:3000/api/auth/callback');

    expect(getRequestOrigin(req)).toBe('http://localhost:3000');
  });
});
