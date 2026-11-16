import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TableActionsMenu } from './table-actions-menu';

describe('<TableActionsMenu />', () => {
  it('renders MoreMenu button, opens on click, and closes when an action is selected', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <TableActionsMenu
        label="Acciones para Acme Corp"
        actions={[
          { id: 'edit', label: 'Editar', onClick: onEdit },
          { id: 'delete', label: 'Inhabilitar', variant: 'danger', onClick: onDelete },
        ]}
      />,
    );

    const button = screen.getByRole('button', { name: 'Acciones para Acme Corp' });
    expect(button).toBeDefined();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // Menu should not be in the DOM initially
    expect(screen.queryByRole('menu')).toBeNull();

    // Click trigger opens menu
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Acciones para Acme Corp' });
    expect(menu).toBeDefined();

    const editBtn = screen.getByRole('menuitem', { name: 'Editar' });
    expect(editBtn).toBeDefined();

    // Clicking an action invokes callback and immediately closes the menu
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape key press', () => {
    render(
      <TableActionsMenu
        label="Acciones de prueba"
        actions={[{ id: 'edit', label: 'Editar', onClick: vi.fn() }]}
      />,
    );

    const button = screen.getByRole('button', { name: 'Acciones de prueba' });
    fireEvent.click(button);
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ensures only one menu can be open at a time across multiple rows', () => {
    render(
      <div>
        <TableActionsMenu
          label="Fila 1"
          actions={[{ id: 'act1', label: 'Acción 1', onClick: vi.fn() }]}
        />
        <TableActionsMenu
          label="Fila 2"
          actions={[{ id: 'act2', label: 'Acción 2', onClick: vi.fn() }]}
        />
      </div>,
    );

    const btn1 = screen.getByRole('button', { name: 'Fila 1' });
    const btn2 = screen.getByRole('button', { name: 'Fila 2' });

    // Open Menu 1
    fireEvent.click(btn1);
    expect(screen.getByRole('menu', { name: 'Fila 1' })).toBeDefined();
    expect(screen.queryByRole('menu', { name: 'Fila 2' })).toBeNull();

    // Clicking Menu 2 trigger must close Menu 1 and open Menu 2
    fireEvent.click(btn2);
    expect(screen.queryByRole('menu', { name: 'Fila 1' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Fila 2' })).toBeDefined();
  });
});
