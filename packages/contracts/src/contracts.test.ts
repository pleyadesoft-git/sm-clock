import { describe, expect, it } from 'vitest';
import {
  canRoleAccessPath,
  ForgotPasswordRequestSchema,
  getDefaultHomeForRole,
  isAuthGuestOnlyPath,
  isPublicPath,
  isSuperAdminOnlyPath,
  isTenantAdminOnlyPath,
  JwtAppMetadataSchema,
  LoginRequestSchema,
  MfaVerifyRequestSchema,
  PasskeyRenameRequestSchema,
  ResetPasswordRequestSchema,
  roleRequiresMfa,
  sanitizeRedirectPath,
  UpdateOwnProfileRequestSchema,
  WebAuthnFactorEnrollSchema,
} from './auth';
import { EmpleadoCreateSchema, SucursalCreateSchema } from './empleado';
import {
  containsCodeInjectionPattern,
  isSafeSmtpHost,
  sanitizeLiveInputValue,
  sanitizeSearchQuery,
  sanitizeTextInput,
} from './sanitize';
import {
  TenantCreateSchema,
  TenantCreateWithAdminSchema,
  TenantListQuerySchema,
} from './tenant';
import {
  AcceptInvitationPasswordRequestSchema,
  CreateSuperAdminRequestSchema,
  InviteUserRequestSchema,
  SmtpConfigUpsertSchema,
  SmtpTestSendSchema,
  UpdateSuperAdminRequestSchema,
} from './usuarios';

describe('@sm-clock/contracts — Auth, Tenant & Usuarios schemas', () => {
  it('validates MFA requirement for SUPER_ADMIN and ADMIN_EMPRESA only', () => {
    expect(roleRequiresMfa('SUPER_ADMIN')).toBe(true);
    expect(roleRequiresMfa('ADMIN_EMPRESA')).toBe(true);
    expect(roleRequiresMfa('OPERADOR')).toBe(false);
  });

  it('validates login request and rejects invalid email or short password', () => {
    const valid = LoginRequestSchema.safeParse({
      email: 'admin@empresa.mx',
      password: 'PasswordSegura123!',
    });
    expect(valid.success).toBe(true);

    const invalid = LoginRequestSchema.safeParse({
      email: 'no-email',
      password: '123',
    });
    expect(invalid.success).toBe(false);
  });

  it('validates forgot and reset password schemas', () => {
    expect(
      ForgotPasswordRequestSchema.safeParse({ email: 'operador@empresa.mx' })
        .success,
    ).toBe(true);
    expect(
      ResetPasswordRequestSchema.safeParse({
        password: 'NuevaPasswordSegura2026!',
        tokenHash: 'tok_recovery_1234567890',
      }).success,
    ).toBe(true);
  });

  it('validates user invitation and SMTP configuration schemas', () => {
    const validInvite = InviteUserRequestSchema.safeParse({
      email: 'Operador1@Empresa.mx',
      nombre_completo: 'María Fernanda López',
      rol: 'OPERADOR',
    });
    expect(validInvite.success).toBe(true);
    if (validInvite.success) {
      expect(validInvite.data.email).toBe('operador1@empresa.mx');
    }

    const defaultGoogleSmtp = SmtpConfigUpsertSchema.safeParse({
      usar_smtp_propio: false,
      remitente_nombre: 'Maquiladora del Pacífico',
    });
    expect(defaultGoogleSmtp.success).toBe(true);

    const invalidCustomSmtp = SmtpConfigUpsertSchema.safeParse({
      usar_smtp_propio: true,
      host: 'smtp.gmail.com',
      puerto: 465,
      seguridad: 'TLS',
      usuario: '',
      remitente_email: '',
    });
    expect(invalidCustomSmtp.success).toBe(false);

    const validAccept = AcceptInvitationPasswordRequestSchema.safeParse({
      token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      nombre_completo: 'María Fernanda López',
      password: 'PasswordSegura123!',
    });
    expect(validAccept.success).toBe(true);
  });

  it('validates 6-digit TOTP code', () => {
    expect(
      MfaVerifyRequestSchema.safeParse({
        factorId: '550e8400-e29b-41d4-a716-446655440000',
        code: '123456',
      }).success,
    ).toBe(true);

    expect(
      MfaVerifyRequestSchema.safeParse({
        factorId: '550e8400-e29b-41d4-a716-446655440000',
        code: '12AB56',
      }).success,
    ).toBe(false);
  });

  it('validates JWT app_metadata claims', () => {
    const res = JwtAppMetadataSchema.safeParse({
      rol: 'ADMIN_EMPRESA',
      tenant_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(res.success).toBe(true);
  });

  it('validates Mexican fiscal fields (RFC, CP, Regimen) in TenantCreateSchema', () => {
    const validTenant = TenantCreateSchema.safeParse({
      tenant_code: 'tij-001',
      nombre_comercial: 'Maquiladora del Pacífico',
      razon_social: 'MAQUILADORA DEL PACIFICO SA DE CV',
      rfc: 'mpa010101abc',
      regimen_fiscal: '601',
      codigo_postal_fiscal: '22000',
      plan_codigo: 'INDUSTRIAL',
      estatus: 'ACTIVO',
      zona_horaria: 'America/Tijuana',
    });

    expect(validTenant.success).toBe(true);
    if (validTenant.success) {
      expect(validTenant.data.tenant_code).toBe('TIJ-001');
      expect(validTenant.data.rfc).toBe('MPA010101ABC');
      expect(validTenant.data.uso_cfdi).toBe('G03');
    }

    const badRfc = TenantCreateSchema.safeParse({
      tenant_code: 'TIJ-002',
      nombre_comercial: 'Empresa Inválida',
      razon_social: 'EMPRESA INVALIDA SA DE CV',
      rfc: 'INVALIDO',
      regimen_fiscal: '601',
      codigo_postal_fiscal: '22000',
    });
    expect(badRfc.success).toBe(false);
  });

  it('applies defaults on TenantListQuerySchema', () => {
    const parsed = TenantListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(1);
      expect(parsed.data.pageSize).toBe(20);
      expect(parsed.data.sortBy).toBe('created_at');
      expect(parsed.data.sortDir).toBe('desc');
    }
  });

  it('requires admin_inicial with valid Google email in TenantCreateWithAdminSchema', () => {
    const missingAdmin = TenantCreateWithAdminSchema.safeParse({
      tenant_code: 'TIJ-010',
      nombre_comercial: 'Industrias Baja',
      razon_social: 'INDUSTRIAS BAJA SA DE CV',
      rfc: 'IBA010101ABC',
      regimen_fiscal: '601',
      codigo_postal_fiscal: '22000',
    });
    expect(missingAdmin.success).toBe(false);

    const withAdmin = TenantCreateWithAdminSchema.safeParse({
      tenant_code: 'TIJ-010',
      nombre_comercial: 'Industrias Baja',
      razon_social: 'INDUSTRIAS BAJA SA DE CV',
      rfc: 'IBA010101ABC',
      regimen_fiscal: '601',
      codigo_postal_fiscal: '22000',
      admin_inicial: {
        nombre_completo: 'Roberto Gómez',
        email: 'Roberto.Gomez@IndustriasBaja.mx',
      },
    });
    expect(withAdmin.success).toBe(true);
    if (withAdmin.success) {
      expect(withAdmin.data.admin_inicial.email).toBe(
        'roberto.gomez@industriasbaja.mx',
      );
    }
  });

  it('validates SmtpTestSendSchema with recipient email', () => {
    const parsed = SmtpTestSendSchema.safeParse({
      usar_smtp_propio: true,
      host: 'smtp.gmail.com',
      puerto: 587,
      seguridad: 'STARTTLS',
      usuario: 'rh@empresa.mx',
      password: 'app-password-1234',
      remitente_email: 'rh@empresa.mx',
      remitente_nombre: 'RH Empresa',
      destinatario_prueba: 'Admin@Empresa.mx',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.destinatario_prueba).toBe('admin@empresa.mx');
    }
  });

  it('validates PasskeyRenameRequestSchema and WebAuthnFactorEnrollSchema', () => {
    expect(
      PasskeyRenameRequestSchema.safeParse({
        passkeyId: '550e8400-e29b-41d4-a716-446655440000',
        friendlyName: 'MacBook Pro Touch ID',
      }).success,
    ).toBe(true);

    expect(
      PasskeyRenameRequestSchema.safeParse({
        passkeyId: 'not-a-uuid',
        friendlyName: 'A',
      }).success,
    ).toBe(false);

    expect(
      WebAuthnFactorEnrollSchema.safeParse({
        friendlyName: 'iPhone Face ID',
      }).success,
    ).toBe(true);
  });

  it('validates CreateSuperAdminRequestSchema and UpdateSuperAdminRequestSchema', () => {
    const validCreate = CreateSuperAdminRequestSchema.safeParse({
      nombre_completo: 'Fundador SaaS',
      email: 'Socio@SmClock.mx ',
    });
    expect(validCreate.success).toBe(true);
    if (validCreate.success) {
      expect(validCreate.data.email).toBe('socio@smclock.mx');
    }

    expect(UpdateSuperAdminRequestSchema.safeParse({}).success).toBe(false);
    expect(
      UpdateSuperAdminRequestSchema.safeParse({ activo: false }).success,
    ).toBe(true);
  });

  it('validates UpdateOwnProfileRequestSchema for user self-service profile updates', () => {
    const valid = UpdateOwnProfileRequestSchema.safeParse({
      nombre_completo: 'María Fernanda López',
      email: 'mflopez@empresa.mx',
      password: 'NuevaPasswordSegura2026!',
    });
    expect(valid.success).toBe(true);

    const validWithoutPassword = UpdateOwnProfileRequestSchema.safeParse({
      nombre_completo: 'María Fernanda López',
      email: 'mflopez@empresa.mx',
    });
    expect(validWithoutPassword.success).toBe(true);

    const invalidShortPassword = UpdateOwnProfileRequestSchema.safeParse({
      nombre_completo: 'María Fernanda López',
      email: 'mflopez@empresa.mx',
      password: '123',
    });
    expect(invalidShortPassword.success).toBe(false);
  });
});

describe('@sm-clock/contracts — Routing Guards & Open Redirect Protection', () => {
  it('classifies public, guest-only, super-admin, and tenant-admin routes accurately', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/invitacion/token123')).toBe(true);
    expect(isPublicPath('/api/auth/callback')).toBe(true);
    expect(isPublicPath('/dashboard')).toBe(false);
    expect(isPublicPath('/login-admin')).toBe(false);

    expect(isAuthGuestOnlyPath('/login')).toBe(true);
    expect(isAuthGuestOnlyPath('/recuperar-contrasena')).toBe(true);
    expect(isAuthGuestOnlyPath('/mfa')).toBe(false);

    expect(isSuperAdminOnlyPath('/admin')).toBe(true);
    expect(isSuperAdminOnlyPath('/admin/empresas')).toBe(true);
    expect(isSuperAdminOnlyPath('/dashboard')).toBe(false);

    expect(isTenantAdminOnlyPath('/empleados')).toBe(true);
    expect(isTenantAdminOnlyPath('/sucursales')).toBe(true);
    expect(isTenantAdminOnlyPath('/usuarios')).toBe(true);
    expect(isTenantAdminOnlyPath('/configuracion')).toBe(true);
    expect(isTenantAdminOnlyPath('/dashboard')).toBe(false);
  });

  it('enforces role-based path access matrix (canRoleAccessPath)', () => {
    expect(getDefaultHomeForRole('SUPER_ADMIN')).toBe('/admin/empresas');
    expect(getDefaultHomeForRole('ADMIN_EMPRESA')).toBe('/dashboard');
    expect(getDefaultHomeForRole('OPERADOR')).toBe('/dashboard');

    // SUPER_ADMIN can access /admin/* and client views
    expect(canRoleAccessPath('SUPER_ADMIN', '/admin/empresas')).toBe(true);
    expect(canRoleAccessPath('SUPER_ADMIN', '/empleados')).toBe(true);
    expect(canRoleAccessPath('SUPER_ADMIN', '/dashboard')).toBe(true);

    // ADMIN_EMPRESA can access client admin views but NOT /admin/*
    expect(canRoleAccessPath('ADMIN_EMPRESA', '/admin/empresas')).toBe(false);
    expect(canRoleAccessPath('ADMIN_EMPRESA', '/empleados')).toBe(true);
    expect(canRoleAccessPath('ADMIN_EMPRESA', '/usuarios')).toBe(true);
    expect(canRoleAccessPath('ADMIN_EMPRESA', '/configuracion')).toBe(true);
    expect(canRoleAccessPath('ADMIN_EMPRESA', '/dashboard')).toBe(true);

    // OPERADOR can ONLY access /dashboard, /dashboard/checadas, /perfil — NOT /empleados, /sucursales, /usuarios, /configuracion, /admin/*
    expect(canRoleAccessPath('OPERADOR', '/dashboard')).toBe(true);
    expect(canRoleAccessPath('OPERADOR', '/dashboard/checadas')).toBe(true);
    expect(canRoleAccessPath('OPERADOR', '/perfil')).toBe(true);
    expect(canRoleAccessPath('OPERADOR', '/empleados')).toBe(false);
    expect(canRoleAccessPath('OPERADOR', '/dashboard/empleados')).toBe(false);
    expect(canRoleAccessPath('OPERADOR', '/sucursales')).toBe(false);
    expect(canRoleAccessPath('OPERADOR', '/usuarios')).toBe(false);
    expect(canRoleAccessPath('OPERADOR', '/configuracion')).toBe(false);
    expect(canRoleAccessPath('OPERADOR', '/admin/empresas')).toBe(false);
  });

  it('prevents Open Redirects and unauthorized role destinations in sanitizeRedirectPath', () => {
    // Rejects external URLs, protocol-relative URLs, backslashes, javascript: schemes
    expect(sanitizeRedirectPath('https://evil.com/phishing', 'ADMIN_EMPRESA')).toBe(
      '/dashboard',
    );
    expect(sanitizeRedirectPath('//evil.com/phishing', 'ADMIN_EMPRESA')).toBe(
      '/dashboard',
    );
    expect(sanitizeRedirectPath('/\\evil.com', 'ADMIN_EMPRESA')).toBe(
      '/dashboard',
    );
    expect(sanitizeRedirectPath('javascript:alert(1)', 'ADMIN_EMPRESA')).toBe(
      '/dashboard',
    );
    expect(sanitizeRedirectPath('/login', 'ADMIN_EMPRESA')).toBe('/dashboard');
    expect(sanitizeRedirectPath('/mfa', 'SUPER_ADMIN')).toBe('/admin/empresas');

    // Prevents redirecting OPERADOR to an admin-only path
    expect(sanitizeRedirectPath('/usuarios', 'OPERADOR')).toBe('/dashboard');
    expect(sanitizeRedirectPath('/admin/empresas', 'ADMIN_EMPRESA')).toBe(
      '/dashboard',
    );

    // Allows valid internal path permitted for the role
    expect(sanitizeRedirectPath('/empleados', 'ADMIN_EMPRESA')).toBe(
      '/empleados',
    );
    expect(sanitizeRedirectPath('/admin/auditoria', 'SUPER_ADMIN')).toBe(
      '/admin/auditoria',
    );
  });
});

describe('@sm-clock/contracts — Input Sanitization & Code Injection Defense', () => {
  it('detects XSS, HTML tags, dangerous URI schemes, event handlers, and SQLi patterns', () => {
    expect(containsCodeInjectionPattern('<script>alert(1)</script>')).toBe(true);
    expect(containsCodeInjectionPattern('<img src=x onerror=alert(1)>')).toBe(
      true,
    );
    expect(containsCodeInjectionPattern('javascript:fetch("http://evil")')).toBe(
      true,
    );
    expect(containsCodeInjectionPattern('onload = alert(1)')).toBe(true);
    expect(containsCodeInjectionPattern('${process.env.SECRET}')).toBe(true);
    expect(containsCodeInjectionPattern("admin' UNION SELECT * FROM tenants--")).toBe(
      true,
    );
    expect(containsCodeInjectionPattern('María Fernanda López Hernández')).toBe(
      false,
    );
    expect(
      containsCodeInjectionPattern('Blvd. Agua Caliente #4500, Col. Aviación'),
    ).toBe(false);
  });

  it('sanitizes text input by stripping tags, control/bidi chars, and formula triggers', () => {
    expect(sanitizeTextInput('  <b>Juan</b>\u202E   Pérez  ')).toBe('Juan Pérez');
    expect(sanitizeTextInput('=CMD|" /C calc"!A0')).toBe('CMD|" /C calc"!A0');
    expect(sanitizeLiveInputValue('Hola <script>javascript:x')).toBe(
      'Hola scriptx',
    );
  });

  it('sanitizes PostgREST search queries to prevent .or() filter injection', () => {
    const malicious = `test%,id.eq.550e8400-e29b-41d4-a716-446655440000,nombre.ilike.%`;
    const cleaned = sanitizeSearchQuery(malicious);
    expect(cleaned).not.toContain(',');
    expect(cleaned).not.toContain('%');
    expect(cleaned).not.toContain('(');
    expect(cleaned).not.toContain(')');
  });

  it('validates SMTP host against SSRF (localhost, .local, private IPs)', () => {
    expect(isSafeSmtpHost('smtp.gmail.com')).toBe(true);
    expect(isSafeSmtpHost('smtp.office365.com')).toBe(true);
    expect(isSafeSmtpHost('localhost')).toBe(false);
    expect(isSafeSmtpHost('127.0.0.1')).toBe(false);
    expect(isSafeSmtpHost('169.254.169.254')).toBe(false);
    expect(isSafeSmtpHost('redis.internal')).toBe(false);
    expect(isSafeSmtpHost('printer.local')).toBe(false);

    const ssrfSmtp = SmtpConfigUpsertSchema.safeParse({
      usar_smtp_propio: true,
      host: '127.0.0.1',
      puerto: 587,
      seguridad: 'STARTTLS',
      usuario: 'admin@empresa.mx',
      remitente_email: 'admin@empresa.mx',
      remitente_nombre: 'Empresa',
    });
    expect(ssrfSmtp.success).toBe(false);
  });

  it('rejects code injection payloads in Empleado, Sucursal, InviteUser, and Tenant schemas', () => {
    expect(
      EmpleadoCreateSchema.safeParse({
        codigo_empleado: 'EMP001',
        nombre_completo: '<script>alert("xss")</script>',
      }).success,
    ).toBe(false);

    expect(
      EmpleadoCreateSchema.safeParse({
        codigo_empleado: 'EMP001',
        nombre_completo: 'Juan Pérez',
        puesto: 'Supervisor onmouseover=alert(1)',
      }).success,
    ).toBe(false);

    expect(
      SucursalCreateSchema.safeParse({
        clave: 'OTAY-1',
        nombre: 'Planta Otay <iframe src="javascript:alert(1)">',
      }).success,
    ).toBe(false);

    expect(
      InviteUserRequestSchema.safeParse({
        email: 'user@empresa.mx',
        nombre_completo: 'Ana ${alert(1)}',
        rol: 'OPERADOR',
      }).success,
    ).toBe(false);

    expect(
      TenantCreateWithAdminSchema.safeParse({
        tenant_code: 'TIJ-010',
        nombre_comercial: 'Industrias <img src=x onerror=alert(1)>',
        razon_social: 'INDUSTRIAS BAJA SA DE CV',
        rfc: 'IBA010101ABC',
        regimen_fiscal: '601',
        codigo_postal_fiscal: '22000',
        admin_inicial: {
          nombre_completo: 'Roberto Gómez',
          email: 'roberto@industriasbaja.mx',
        },
      }).success,
    ).toBe(false);
  });
});


