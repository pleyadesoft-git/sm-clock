import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import writeXlsxFile, {
  type Row,
  type SheetData,
} from 'write-excel-file/universal';
import { formatFechaHoraMx } from '@/lib/utils';
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

export async function buildPdfBlob<T>(
  options: ExportOptions<T>,
): Promise<Blob> {
  const orientation = options.columns.length > 5 ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'pt',
    format: 'letter',
  });

  const margin = 36;
  const nowStr = formatFechaHoraMx(new Date(), 'America/Tijuana');

  // Membrete superior institucional SM Clock
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('SM CLOCK · PLATAFORMA DE ASISTENCIA', margin, 32);

  // Título del reporte
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(options.title, margin, 48);

  // Subtítulo con total de registros y timestamp
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const metaParts: string[] = [];
  if (options.subtitle) {
    metaParts.push(options.subtitle);
  }
  metaParts.push(`Generado: ${nowStr} (Tijuana, B.C.)`);
  doc.text(metaParts.join('  ·  '), margin, 60);

  const head = [options.columns.map((col) => neutralizeFormulaCell(col.header))];
  const body = options.rows.map((row) =>
    options.columns.map((col) => {
      const val = col.accessor(row);
      const safe = neutralizeFormulaCell(val);
      return safe;
    }),
  );

  autoTable(doc, {
    startY: 72,
    margin: { left: margin, right: margin, bottom: 40 },
    head,
    body,
    theme: 'striped',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 4,
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [30, 41, 59],
      cellPadding: 4,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    styles: {
      overflow: 'linebreak',
      valign: 'middle',
    },
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageSize = doc.internal.pageSize;
    const pageHeight = pageSize.height || pageSize.getHeight();
    const pageWidth = pageSize.width || pageSize.getWidth();

    // Línea divisoria en pie de página
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, pageHeight - 26, pageWidth - margin, pageHeight - 26);

    // Leyenda y número de página
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text('Confidencial · SM Clock', margin, pageHeight - 14);

    const pageStr = `Página ${i} de ${totalPages}`;
    doc.text(
      pageStr,
      pageWidth - margin - doc.getTextWidth(pageStr),
      pageHeight - 14,
    );
  }

  const arrayBuffer = doc.output('arraybuffer');
  return new Blob([arrayBuffer], { type: 'application/pdf' });
}

export async function exportToPdf<T>(
  options: ExportOptions<T>,
): Promise<void> {
  const blob = await buildPdfBlob(options);
  triggerDownload(blob, `${options.filename}.pdf`);
}

export async function exportToPdfPrint<T>(
  options: ExportOptions<T>,
): Promise<void> {
  return exportToPdf(options);
}
