import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';

const mockRouter = {
  replace: vi.fn(),
  push: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

describe('<AppShell /> Menú nav responsivo y gestos táctiles', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            rol: 'ADMIN_EMPRESA',
            nombreCompleto: 'Admin Test',
            email: 'admin@smclock.test',
            avatarUrl: null,
          },
        }),
      }),
    );
  });

  it('permite colapsar y expandir el menú lateral en escritorio y guarda la preferencia en localStorage', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    const toggleBtn = screen.getByRole('button', { name: /Colapsar menú lateral/i });
    expect(toggleBtn).toBeDefined();

    const desktopSidebar = document.getElementById('desktop-nav-sidebar');
    expect(desktopSidebar).not.toBeNull();
    expect(desktopSidebar?.className).toContain('w-[var(--sidebar-w)]');

    // Clic en el botón del encabezado colapsa el sidebar
    fireEvent.click(toggleBtn);
    expect(desktopSidebar?.className).toContain('w-0');
    expect(localStorage.getItem('sm_clock_sidebar_open')).toBe('false');

    // Clic de nuevo expande el sidebar
    fireEvent.click(toggleBtn);
    expect(desktopSidebar?.className).toContain('w-[var(--sidebar-w)]');
    expect(localStorage.getItem('sm_clock_sidebar_open')).toBe('true');
  });

  it('permite colapsar el menú lateral desde el botón de la barra lateral', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );

    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    const collapseInSidebarBtn = screen.getByTitle('Colapsar barra lateral');
    fireEvent.click(collapseInSidebarBtn);

    const desktopSidebar = document.getElementById('desktop-nav-sidebar');
    expect(desktopSidebar?.className).toContain('w-0');
    expect(localStorage.getItem('sm_clock_sidebar_open')).toBe('false');
  });

  it('abre y cierra el cajón de navegación en pantallas móviles y tablets con el botón del encabezado', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 768 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    const toggleBtn = screen.getByRole('button', { name: /Colapsar menú lateral|Abrir menú de navegación/i });
    fireEvent.click(toggleBtn);

    // El diálogo móvil debe estar visible
    const mobileDrawer = await screen.findByRole('dialog', { name: /Menú de navegación principal/i });
    expect(mobileDrawer).toBeDefined();

    // Botón de cerrar (X) dentro del cajón
    const closeBtn = screen.getByRole('button', { name: /Cerrar panel de navegación/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Menú de navegación principal/i })).toBeNull();
    });
  });

  it('cierra el cajón móvil al presionar la tecla Escape', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 768 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    const toggleBtn = screen.getByRole('button', { name: /Colapsar menú lateral|Abrir menú de navegación/i });
    fireEvent.click(toggleBtn);

    await screen.findByRole('dialog', { name: /Menú de navegación principal/i });

    // Presionar tecla Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Menú de navegación principal/i })).toBeNull();
    });
  });

  it('incluye botón "Menú" en la barra inferior móvil cuando hay más de 5 ítems y abre el cajón', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    const menuTabBtn = screen.getByRole('button', { name: /Abrir menú completo de navegación/i });
    expect(menuTabBtn).toBeDefined();

    fireEvent.click(menuTabBtn);

    const mobileDrawer = await screen.findByRole('dialog', { name: /Menú de navegación principal/i });
    expect(mobileDrawer).toBeDefined();
  });

  it('permite abrir el cajón deslizando con el dedo desde el borde izquierdo (edge swipe)', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    // Simular deslizamiento táctil desde el borde izquierdo (x=10 -> x=80)
    fireEvent.touchStart(window, {
      touches: [{ clientX: 10, clientY: 200 }],
    });
    fireEvent.touchEnd(window, {
      changedTouches: [{ clientX: 80, clientY: 205 }],
    });

    const mobileDrawer = await screen.findByRole('dialog', { name: /Menú de navegación principal/i });
    expect(mobileDrawer).toBeDefined();
  });

  it('permite cerrar el cajón deslizando con el dedo hacia la izquierda', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    // Abrir cajón
    const menuTabBtn = screen.getByRole('button', { name: /Abrir menú completo de navegación/i });
    fireEvent.click(menuTabBtn);

    const mobileDrawer = await screen.findByRole('dialog', { name: /Menú de navegación principal/i });
    expect(mobileDrawer).toBeDefined();

    // Simular deslizamiento hacia la izquierda en el cajón (x=150 -> x=50, deltaX = -100)
    fireEvent.touchStart(mobileDrawer, {
      touches: [{ clientX: 150, clientY: 200 }],
    });
    fireEvent.touchEnd(mobileDrawer, {
      changedTouches: [{ clientX: 50, clientY: 202 }],
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Menú de navegación principal/i })).toBeNull();
    });
  });

  it('permite abrir las opciones del perfil desde el avatar en la parte inferior del cajón de navegación', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    // Abrir cajón móvil
    const menuTabBtn = screen.getByRole('button', { name: /Abrir menú completo de navegación/i });
    fireEvent.click(menuTabBtn);

    const mobileDrawer = await screen.findByRole('dialog', { name: /Menú de navegación principal/i });
    expect(mobileDrawer).toBeDefined();

    // El avatar y botón de usuario está dentro del cajón en la parte inferior
    const userMenuBtn = within(mobileDrawer).getByRole('button', { name: /Abrir menú de perfil y credenciales de usuario/i });
    expect(userMenuBtn).toBeDefined();

    // Clic para abrir el menú de usuario
    fireEvent.click(userMenuBtn);

    // Verificar las opciones de cuenta y seguridad
    expect(screen.getByText('Datos principales (Nombre y Email)')).toBeDefined();
    expect(screen.getByText('Usuario y Contraseña')).toBeDefined();
    expect(screen.getByText('Biométricos y WebAuthn')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Cerrar sesión/i })).toBeDefined();

    // Probar acción de cerrar sesión
    const logoutBtn = screen.getByRole('menuitem', { name: /Cerrar sesión/i });
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/login?logged_out=1');
    });
  });

  it('muestra el avatar y menú de opciones en la parte inferior de la barra lateral de escritorio', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
    render(
      <AppShell title="Dashboard" mode="client" userRole="ADMIN_EMPRESA">
        <div>Contenido Principal</div>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getByText('Contenido Principal')).toBeDefined());

    // Botón de avatar en el sidebar de escritorio
    const desktopSidebar = document.getElementById('desktop-nav-sidebar');
    expect(desktopSidebar).not.toBeNull();
    if (!desktopSidebar) return;
    const userMenuBtn = within(desktopSidebar).getByRole('button', { name: /Abrir menú de perfil y credenciales de usuario/i });
    expect(userMenuBtn).toBeDefined();

    fireEvent.click(userMenuBtn);

    expect(screen.getByText('Datos principales (Nombre y Email)')).toBeDefined();
    expect(screen.getByText('Usuario y Contraseña')).toBeDefined();
    expect(screen.getByText('Biométricos y WebAuthn')).toBeDefined();
  });
});
