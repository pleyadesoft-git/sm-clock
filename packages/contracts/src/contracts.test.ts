import { describe, expect, it } from 'vitest';
import {
  ForgotPasswordRequestSchema,
  JwtAppMetadataSchema,
  LoginRequestSchema,
  MfaVerifyRequestSchema,
  ResetPasswordRequestSchema,
  roleRequiresMfa,
} from './auth';
import {
  TenantCreateSchema,
  TenantCreateWithAdminSchema,
  TenantListQuerySchema,
} from './tenant';
import {
  AcceptInvitationPasswordRequestSchema,
  InviteUserRequestSchema,
  SmtpConfigUpsertSchema,
  SmtpTestSendSchema,
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
});

