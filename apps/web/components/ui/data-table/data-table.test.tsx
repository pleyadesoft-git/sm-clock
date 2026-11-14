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
});
