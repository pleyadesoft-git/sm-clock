import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ErrorDialog } from './error-dialog';

describe('<ErrorDialog />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders friendly message, hr separator and technical details', () => {
    const onOpenChange = vi.fn();
    render(
      <ErrorDialog
        open={true}
        onOpenChange={onOpenChange}
        error={{
          title: 'Error al registrar empresa',
          userMessage: 'Por favor verifica la información capturada.',
          technicalDetails: 'ZodError: [contacto_email] Correo inválido',
          endpoint: 'POST /api/admin/tenants',
          status: 400,
        }}
      />,
    );

    expect(screen.getByText('Error al registrar empresa')).toBeDefined();
    expect(
      screen.getByText('Por favor verifica la información capturada.'),
    ).toBeDefined();
    expect(
      screen.getByText('ZodError: [contacto_email] Correo inválido'),
    ).toBeDefined();
    expect(screen.getByText('Código: 400')).toBeDefined();

    // Verify copy button exists
    const copyBtn = screen.getByRole('button', { name: /Copiar reporte/i });
    expect(copyBtn).toBeDefined();

    // Verify close button
    const closeBtn = screen.getByRole('button', { name: 'Cerrar' });
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
