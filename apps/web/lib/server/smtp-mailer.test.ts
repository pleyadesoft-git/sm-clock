import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildInvitationEmailTemplate,
  buildPasswordRecoveryEmailTemplate,
} from './smtp-mailer';

describe('smtp-mailer templates', () => {
  it('builds escaped invitation email template with Admin or Operador role and pre-registration link', () => {
    const operadorEmail = buildInvitationEmailTemplate({
      nombreCompleto: 'María <Operadora>',
      tenantNombre: 'Maquiladora & Asociados',
      rol: 'OPERADOR',
      inviteUrl: 'https://sm-clock.mx/invitacion/tok123456',
      expiraEnFormatted: '20 nov 2026, 18:00',
    });

    expect(operadorEmail.subject).toContain('Operador');
    expect(operadorEmail.html).toContain('María &lt;Operadora&gt;');
    expect(operadorEmail.html).toContain('Maquiladora &amp; Asociados');
    expect(operadorEmail.html).toContain(
      'https://sm-clock.mx/invitacion/tok123456',
    );
    expect(operadorEmail.html).toContain('Google Auth');

    const adminEmail = buildInvitationEmailTemplate({
      nombreCompleto: 'Carlos Admin',
      tenantNombre: 'Maquiladora del Pacífico',
      rol: 'ADMIN_EMPRESA',
      inviteUrl: 'https://sm-clock.mx/invitacion/tok999',
      expiraEnFormatted: '20 nov 2026, 18:00',
    });
    expect(adminEmail.subject).toContain('Administrador');
  });

  it('builds escaped password recovery email template with reset link', () => {
    const recovery = buildPasswordRecoveryEmailTemplate({
      nombreCompleto: 'Juan <script>alert(1)</script>',
      resetUrl:
        'https://sm-clock.mx/restablecer-contrasena?token_hash=abc123&type=recovery',
    });

    expect(recovery.subject).toContain('Recuperación de contraseña');
    expect(recovery.html).not.toContain('<script>');
    expect(recovery.html).toContain('&lt;script&gt;');
    expect(recovery.html).toContain('token_hash=abc123');
  });
});
