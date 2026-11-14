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

function escapeXml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildSpreadsheetXmlContent<T>(
  options: ExportOptions<T>,
): string {
  const headerCells = options.columns
    .map(
      (col) =>
        `<Cell><Data ss:Type="String">${escapeXml(neutralizeFormulaCell(col.header))}</Data></Cell>`,
    )
    .join('');

  const dataRows = options.rows
    .map((row) => {
      const cells = options.columns
        .map((col) => {
          const safeVal = neutralizeFormulaCell(col.accessor(row));
          return `<Cell><Data ss:Type="String">${escapeXml(safeVal)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    `<Worksheet ss:Name="${escapeXml(options.title.slice(0, 31))}">`,
    `<Table><Row>${headerCells}</Row>${dataRows}</Table>`,
    '</Worksheet>',
    '</Workbook>',
  ].join('');
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

export function exportToXlsx<T>(options: ExportOptions<T>): void {
  const content = buildSpreadsheetXmlContent(options);
  const blob = new Blob([content], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  });
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
