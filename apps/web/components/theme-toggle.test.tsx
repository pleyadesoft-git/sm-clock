import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './theme-toggle';

describe('<ThemeToggle /> Claro / Oscuro switcher', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset['theme'];

    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="color-scheme"]',
    );
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'color-scheme';
      meta.content = 'light dark';
      document.head.appendChild(meta);
    } else {
      meta.content = 'light dark';
    }

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
  });

  it('renders both Claro and Oscuro options and switches between themes cleanly', () => {
    render(<ThemeToggle />);

    const lightRadio = screen.getByRole('radio', { name: 'Claro' });
    const darkRadio = screen.getByRole('radio', { name: 'Oscuro' });

    expect(lightRadio.getAttribute('aria-checked')).toBe('true');
    expect(darkRadio.getAttribute('aria-checked')).toBe('false');
    expect(document.documentElement.classList.contains('light')).toBe(true);

    // Switch to dark mode
    fireEvent.click(darkRadio);
    expect(darkRadio.getAttribute('aria-checked')).toBe('true');
    expect(lightRadio.getAttribute('aria-checked')).toBe('false');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('color-scheme')).toBe('dark');

    // Switch back to light mode (matches mocked system preference -> removes localStorage override)
    fireEvent.click(lightRadio);
    expect(lightRadio.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('color-scheme')).toBeNull();
  });
});
