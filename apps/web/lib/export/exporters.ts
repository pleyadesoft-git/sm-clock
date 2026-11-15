import writeXlsxFile, {
  type Row,
  type SheetData,
} from 'write-excel-file/universal';
import { escapeCsvCell, neutralizeFormulaCell } from './sanitize';

export interface ExportColumn<T> {
  header: string;
  accessor: (row: T) => unknown;
}

export interface ExportOptions<T> {
  filename: string;
  title: string;
  subtitle?: string;
  columns: readonly ExportColumn<T>[];
  rows: readonly T[];
}

export function buildCsvContent<T>(options: ExportOptions<T>): string {
  const headerLine = options.columns
    .map((col) => escapeCsvCell(col.header))
    .join(',');
  const bodyLines = options.rows.map((row) =>
    options.columns.map((col) => escapeCsvCell(col.accessor(row))).join(','),
  );
  // Prepend UTF-8 BOM para compatibilidad directa con Excel en español (es-MX)
  return `\uFEFF${[headerLine, ...bodyLines].join('\r\n')}`;
}

export function sanitizeSheetName(name: string): string {
  const sanitized = name.replace(/[\\/?*[\]:]/g, ' ').trim();
  return sanitized.slice(0, 31) || 'Hoja1';
}

export async function buildXlsxBlob<T>(
  options: ExportOptions<T>,
): Promise<Blob> {
  const headerRow: Row = options.columns.map((col) => ({
    value: neutralizeFormulaCell(col.header),
    fontWeight: 'bold',
  }));

  const dataRows: Row[] = options.rows.map((row) =>
    options.columns.map((col) => {
      const raw = col.accessor(row);
      const safe = neutralizeFormulaCell(raw);
      return {
        value: safe,
      };
    }),
  );

  const sheetData: SheetData = [headerRow, ...dataRows];

  const columns = options.columns.map((col) => {
    const headerLen = col.header.length;
    return { width: Math.max(headerLen + 4, 15) };
  });

  const sheetName = sanitizeSheetName(options.title);

  return writeXlsxFile(sheetData, {
    sheet: sheetName,
    stickyRowsCount: 1,
    columns,
  }).toBlob();
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCsv<T>(options: ExportOptions<T>): void {
  const content = buildCsvContent(options);
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${options.filename}.csv`);
}

export async function exportToXlsx<T>(
  options: ExportOptions<T>,
): Promise<void> {
  const blob = await buildXlsxBlob(options);
  triggerDownload(blob, `${options.filename}.xlsx`);
}

export function exportToPdfPrint<T>(options: ExportOptions<T>): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) return;

  const doc = printWindow.document;
  doc.title = options.title;

  const container = doc.createElement('div');
  const heading = doc.createElement('h1');
  heading.textContent = options.title;
  container.appendChild(heading);

  if (options.subtitle) {
    const sub = doc.createElement('p');
    sub.textContent = options.subtitle;
    container.appendChild(sub);
  }

  const table = doc.createElement('table');
  table.setAttribute('border', '1');
  table.setAttribute('cellpadding', '6');
  table.setAttribute('cellspacing', '0');

  const thead = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const col of options.columns) {
    const th = doc.createElement('th');
    th.textContent = neutralizeFormulaCell(col.header);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement('tbody');
  for (const row of options.rows) {
    const tr = doc.createElement('tr');
    for (const col of options.columns) {
      const td = doc.createElement('td');
      td.textContent = neutralizeFormulaCell(col.accessor(row));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  doc.body.appendChild(container);
  printWindow.focus();
  printWindow.print();
}
