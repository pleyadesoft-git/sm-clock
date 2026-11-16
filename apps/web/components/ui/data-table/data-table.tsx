'use client';

import * as React from 'react';
import {
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type RowData,
} from '@tanstack/react-table';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Inbox,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  exportToCsv,
  exportToPdf,
  exportToXlsx,
  type ExportColumn,
} from '@/lib/export/exporters';

export const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  unknown
>;

export interface DataTableFilterOption {
  label: string;
  value: string;
}

export interface DataTableFilterConfig {
  id: string;
  label: string;
  value: string | undefined;
  options: readonly DataTableFilterOption[];
  onChange: (value: string | undefined) => void;
}

export interface DataTableProps<TData extends RowData> {
  caption: string;
  columns: DataTableColumnDef<TData>[];
  data: TData[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  search?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (columnId: string, dir: 'asc' | 'desc') => void;
  filters?: readonly DataTableFilterConfig[];
  onClearFilters?: () => void;
  exportColumns: readonly ExportColumn<TData>[];
  exportFilename: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

type TableDensity = 'comfortable' | 'compact';

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Cómoda' },
  { value: 'compact', label: 'Compacta' },
] as const;

export function DataTable<TData extends RowData>({
  caption,
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  search = '',
  onSearchChange,
  searchPlaceholder = 'Buscar…',
  sortBy,
  sortDir = 'desc',
  onSortChange,
  filters = [],
  onClearFilters,
  exportColumns,
  exportFilename,
  isLoading = false,
  errorMessage = null,
  emptyTitle = 'Sin registros para mostrar',
  emptyDescription = 'Ajusta los filtros de búsqueda o registra un nuevo elemento.',
  emptyAction,
}: DataTableProps<TData>) {
  const captionId = React.useId();
  const [localSearch, setLocalSearch] = React.useState(search);
  const [density, setDensity] = React.useState<TableDensity>('comfortable');
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({});
  const [showColumnsMenu, setShowColumnsMenu] = React.useState(false);
  const [sortStatusAnnouncement, setSortStatusAnnouncement] =
    React.useState('');

  React.useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  // Debounce de 300 ms para la búsqueda global (UI-UX-IOS.md §4)
  React.useEffect(() => {
    if (!onSearchChange || localSearch === search) return;
    const timer = window.setTimeout(() => {
      onSearchChange(localSearch);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [localSearch, onSearchChange, search]);

  const [internalSortBy, setInternalSortBy] = React.useState<
    string | undefined
  >(sortBy);
  const [internalSortDir, setInternalSortDir] = React.useState<
    'asc' | 'desc'
  >(sortDir);

  const effectiveSortBy = sortBy !== undefined ? sortBy : internalSortBy;
  const effectiveSortDir = sortBy !== undefined ? sortDir : internalSortDir;

  React.useEffect(() => {
    if (sortBy !== undefined) {
      setInternalSortBy(sortBy);
    }
  }, [sortBy]);

  React.useEffect(() => {
    if (sortDir !== undefined) {
      setInternalSortDir(sortDir);
    }
  }, [sortDir]);

  // Si onSortChange no se proporciona, realizar ordenamiento client-side automáticamente
  const sortedData = React.useMemo(() => {
    if (onSortChange || !effectiveSortBy) return data;
    return [...data].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[effectiveSortBy];
      const bVal = (b as Record<string, unknown>)[effectiveSortBy];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return effectiveSortDir === 'asc' ? 1 : -1;
      if (bVal == null) return effectiveSortDir === 'asc' ? -1 : 1;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return effectiveSortDir === 'asc'
          ? aVal.localeCompare(bVal, 'es-MX')
          : bVal.localeCompare(aVal, 'es-MX');
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return effectiveSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return effectiveSortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal), 'es-MX')
        : String(bVal).localeCompare(String(aVal), 'es-MX');
    });
  }, [data, onSortChange, effectiveSortBy, effectiveSortDir]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: sortedData,
    state: {
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
    rowCount: total,
    manualPagination: true,
    manualSorting: true,
  });

  const activeFilters = filters.filter(
    (f) => f.value !== undefined && f.value !== '',
  );
  const hasActiveSearchOrFilter =
    activeFilters.length > 0 || search.trim().length > 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSortClick = (columnId: string, headerText: string) => {
    const nextDir: 'asc' | 'desc' =
      effectiveSortBy === columnId && effectiveSortDir === 'asc'
        ? 'desc'
        : 'asc';

    if (onSortChange) {
      onSortChange(columnId, nextDir);
    } else {
      setInternalSortBy(columnId);
      setInternalSortDir(nextDir);
    }

    setSortStatusAnnouncement(
      `Ordenado por ${headerText}, ${nextDir === 'asc' ? 'ascendente' : 'descendente'}, ${data.length} filas`,
    );
  };

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    const payload = {
      filename: exportFilename,
      title: caption,
      subtitle: `Total: ${total} registros`,
      columns: exportColumns,
      rows: data,
    };
    if (format === 'csv') exportToCsv(payload);
    if (format === 'xlsx') await exportToXlsx(payload);
    if (format === 'pdf') await exportToPdf(payload);
  };

  return (
    <div className="flex flex-col gap-[var(--s-4)]">
      {/* Región de anuncio accesible para ordenamiento (sortable-table) */}
      <div role="status" className="sr-status">
        {sortStatusAnnouncement}
      </div>

      {/* Barra de controles superior */}
      <div className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-4)] shadow-[var(--shadow-1)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
          {/* Búsqueda global con debounce 300ms */}
          {onSearchChange ? (
            <div className="relative min-w-64 flex-1">
              <Search
                className="pointer-events-none absolute left-[var(--s-3)] top-1/2 size-4 -translate-y-1/2 text-[var(--text-2)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <Input
                type="search"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                enterKeyHint="search"
                className="has-search-icon !pl-[var(--s-10)] !ps-[var(--s-10)]"
              />
            </div>
          ) : null}

          {/* Filtros por columna */}
          {filters.map((filter) => (
            <div key={filter.id} className="flex items-center gap-[var(--s-2)]">
              <label
                htmlFor={`filter-${filter.id}`}
                className="ios-label"
              >
                {filter.label}
              </label>
              <select
                id={`filter-${filter.id}`}
                value={filter.value ?? ''}
                onChange={(e) =>
                  filter.onChange(e.target.value || undefined)
                }
                className="ios-input min-w-36"
              >
                <option value="">Todos</option>
                {filter.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Densidad, Columnas y Exportación */}
          <div className="flex flex-wrap items-center gap-[var(--s-2)]">
            <SegmentedControl
              ariaLabel="Densidad de la tabla"
              options={DENSITY_OPTIONS}
              value={density}
              onChange={setDensity}
            />

            <div className="relative">
              <Button
                variant="secondary"
                onClick={() => setShowColumnsMenu((v) => !v)}
                aria-expanded={showColumnsMenu}
              >
                <SlidersHorizontal
                  className="size-4"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span>Columnas</span>
              </Button>
              {showColumnsMenu ? (
                <div className="absolute right-0 top-full z-40 mt-[var(--s-2)] flex min-w-48 flex-col gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-3)] shadow-[var(--shadow-2)]">
                  {table
                    .getAllLeafColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => (
                      <label
                        key={column.id}
                        className="flex cursor-pointer items-center gap-[var(--s-2)] text-sm text-[var(--text)]"
                      >
                        <input
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={column.getToggleVisibilityHandler()}
                        />
                        <span>{column.id}</span>
                      </label>
                    ))}
                </div>
              ) : null}
            </div>

            <Button
              variant="secondary"
              onClick={() => handleExport('csv')}
              aria-label="Exportar a CSV"
            >
              <Download
                className="size-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>CSV</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport('xlsx')}
              aria-label="Exportar a XLSX"
            >
              <FileSpreadsheet
                className="size-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>XLSX</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport('pdf')}
              aria-label="Exportar a PDF"
            >
              <FileText
                className="size-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>PDF</span>
            </Button>
          </div>
        </div>

        {/* Chips de filtros activos y botón Limpiar */}
        {hasActiveSearchOrFilter ? (
          <div className="flex flex-wrap items-center gap-[var(--s-2)] border-t border-[var(--separator)] pt-[var(--s-3)]">
            <span className="ios-label">
              Filtros activos:
            </span>
            {search.trim() ? (
              <Badge variant="default">Búsqueda: &ldquo;{search}&rdquo;</Badge>
            ) : null}
            {activeFilters.map((f) => {
              const selectedLabel =
                f.options.find((o) => o.value === f.value)?.label ?? f.value;
              return (
                <Badge key={f.id} variant="default">
                  {f.label}: {selectedLabel}
                </Badge>
              );
            })}
            <Button
              variant="plain"
              onClick={() => {
                setLocalSearch('');
                onSearchChange?.('');
                onClearFilters?.();
              }}
              className="text-xs"
            >
              <X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              <span>Limpiar</span>
            </Button>
          </div>
        ) : null}
      </div>

      {/* Estado de Error */}
      {errorMessage ? (
        <EmptyState
          icon={AlertTriangle}
          title="No se pudieron cargar los datos"
          description={errorMessage}
        />
      ) : isLoading ? (
        /* Estado de Carga (Skeleton) */
        <div
          aria-busy="true"
          aria-label="Cargando registros"
          className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-4)]"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : data.length === 0 ? (
        /* Estado Vacío */
        <EmptyState
          icon={Inbox}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        /* Tabla Semántica con Sticky Headers y Container Query (<640px Tarjetas) */
        <div
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="table-wrapper"
        >
          <table className="ios-table" data-density={density}>
            <caption id={captionId} className="sr-status">
              {caption}
            </caption>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const colId = header.column.id;
                    const canSort = header.column.getCanSort();
                    const isSorted = effectiveSortBy === colId;
                    const ariaSortValue: 'ascending' | 'descending' | undefined =
                      isSorted
                        ? effectiveSortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined;
                    const headerLabel =
                      typeof header.column.columnDef.header === 'string'
                        ? header.column.columnDef.header
                        : colId;

                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={ariaSortValue}
                        data-col-id={colId}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={() => handleSortClick(colId, headerLabel)}
                          >
                            <span>
                              <table.FlexRender header={header} />
                            </span>
                            {isSorted ? (
                              sortDir === 'asc' ? (
                                <ArrowUp
                                  className="size-4 shrink-0 text-[var(--accent)]"
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                              ) : (
                                <ArrowDown
                                  className="size-4 shrink-0 text-[var(--accent)]"
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                />
                              )
                            ) : (
                              <ArrowUpDown
                                className="size-4 shrink-0 opacity-40"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-[var(--surface-2)]"
                >
                  {row.getVisibleCells().map((cell, cellIdx) => {
                    const label =
                      typeof cell.column.columnDef.header === 'string'
                        ? cell.column.columnDef.header
                        : cell.column.id;
                    if (cellIdx === 0) {
                      return (
                        <th key={cell.id} scope="row">
                          <table.FlexRender cell={cell} />
                        </th>
                      );
                    }
                    return (
                      <td
                        key={cell.id}
                        data-label={label}
                        data-col-id={cell.column.id}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación del lado del servidor */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] px-[var(--s-4)] py-[var(--s-3)] shadow-[var(--shadow-1)]">
        <div className="flex items-center gap-[var(--s-2)] text-sm text-[var(--text-2)]">
          <span>
            Mostrando página <strong className="text-[var(--text)]">{page}</strong> de{' '}
            <strong className="text-[var(--text)]">{totalPages}</strong> ({total}{' '}
            registros)
          </span>
        </div>

        <div className="flex items-center gap-[var(--s-3)]">
          <div className="flex items-center gap-[var(--s-2)]">
            <label
              htmlFor="page-size-select"
              className="ios-label"
            >
              Filas por página
            </label>
            <select
              id="page-size-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="ios-input w-20"
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-[var(--s-2)]">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft
                className="size-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Página siguiente"
            >
              <ChevronRight
                className="size-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
