import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumnDef } from './data-table';

interface SampleRow {
  id: string;
  nombre: string;
  rfc: string;
}

const columns: DataTableColumnDef<SampleRow>[] = [
  {
    id: 'nombre',
    accessorKey: 'nombre',
    header: 'Empresa',
  },
  {
    id: 'rfc',
    accessorKey: 'rfc',
    header: 'RFC',
  },
];

describe('<DataTable /> standard component', () => {
  it('renders semantic table with sticky row header and aria-sort on sorted column only', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        caption="Directorio de empresas"
        columns={columns}
        data={[
          { id: '1', nombre: 'Maquiladora del Pacífico', rfc: 'MPA010101ABC' },
        ]}
        total={1}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        sortBy="nombre"
        sortDir="asc"
        onSortChange={onSortChange}
        exportColumns={[
          { header: 'Empresa', accessor: (r) => r.nombre },
          { header: 'RFC', accessor: (r) => r.rfc },
        ]}
        exportFilename="empresas"
      />,
    );

    const region = screen.getByRole('region', {
      name: 'Directorio de empresas',
    });
    expect(region).toBeDefined();

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]?.getAttribute('aria-sort')).toBe('ascending');
    expect(headers[1]?.getAttribute('aria-sort')).toBeNull();

    const sortBtn = screen.getByRole('button', { name: 'Empresa' });
    fireEvent.click(sortBtn);
    expect(onSortChange).toHaveBeenCalledWith('nombre', 'desc');
  });

  it('renders EmptyState when data is empty', () => {
    render(
      <DataTable
        caption="Tabla vacía"
        columns={columns}
        data={[]}
        total={0}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        exportColumns={[]}
        exportFilename="vacio"
        emptyTitle="No hay empresas registradas"
      />,
    );

    expect(screen.getByText('No hay empresas registradas')).toBeDefined();
  });

  it('renders search input with has-search-icon class and search attributes', () => {
    const onSearchChange = vi.fn();
    render(
      <DataTable
        caption="Empresas con búsqueda"
        columns={columns}
        data={[{ id: '1', nombre: 'Test', rfc: 'TST010101' }]}
        total={1}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        exportColumns={[]}
        exportFilename="test"
        onSearchChange={onSearchChange}
        searchPlaceholder="Buscar por nombre comercial, razón social, RFC o código…"
      />,
    );

    const searchInput = screen.getByRole('searchbox', {
      name: 'Buscar por nombre comercial, razón social, RFC o código…',
    });
    expect(searchInput).toBeDefined();
    expect(searchInput.classList.contains('has-search-icon')).toBe(true);
  });

  it('sorts data client-side when onSortChange is not provided and a header is clicked', () => {
    render(
      <DataTable
        caption="Empresas con orden automático"
        columns={columns}
        data={[
          { id: '1', nombre: 'Beta Corp', rfc: 'BBB010101' },
          { id: '2', nombre: 'Alpha Inc', rfc: 'AAA010101' },
        ]}
        total={2}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        exportColumns={[]}
        exportFilename="test"
      />,
    );

    const sortBtn = screen.getByRole('button', { name: 'Empresa' });
    expect(sortBtn).toBeDefined();

    // Click header to sort by Empresa asc
    fireEvent.click(sortBtn);
    let rows = screen.getAllByRole('row');
    // First data row (index 1) should be Alpha Inc
    expect(rows[1]?.textContent).toContain('Alpha Inc');

    // Click again to sort desc
    fireEvent.click(sortBtn);
    rows = screen.getAllByRole('row');
    expect(rows[1]?.textContent).toContain('Beta Corp');
  });
});

