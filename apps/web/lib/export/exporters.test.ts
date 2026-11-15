import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCsvContent,
  buildXlsxBlob,
  exportToCsv,
  exportToXlsx,
  sanitizeSheetName,
} from './exporters';

interface SampleTenant {
  codigo: string;
  nombre: string;
  rfc: string;
  formulaPayload?: string;
}

const sampleColumns = [
  { header: 'Código', accessor: (r: SampleTenant) => r.codigo },
  { header: 'Nombre Comercial', accessor: (r: SampleTenant) => r.nombre },
  { header: 'RFC', accessor: (r: SampleTenant) => r.rfc },
  {
    header: 'Inyección',
    accessor: (r: SampleTenant) => r.formulaPayload ?? '',
  },
];

const sampleRows: SampleTenant[] = [
  {
    codigo: 'CLI-001',
    nombre: 'Maquiladora del Pacífico, S.A. de C.V.',
    rfc: 'MPA010101ABC',
    formulaPayload: '=1+1',
  },
  {
    codigo: 'CLI-002',
    nombre: 'Tecnología "Avanzada"',
    rfc: 'TAV020202XYZ',
    formulaPayload: '+SUM(A1:B1)',
  },
];

describe('sanitizeSheetName', () => {
  it('truncates sheet name to 31 characters', () => {
    const longName = 'Directorio de empresas registradas en el sistema SM Clock 2026';
    const sanitized = sanitizeSheetName(longName);
    expect(sanitized.length).toBeLessThanOrEqual(31);
    expect(sanitized).toBe('Directorio de empresas registra');
  });

  it('removes invalid Excel characters', () => {
    expect(sanitizeSheetName('Empresas: 2026 / [Tijuana]*?')).toBe(
      'Empresas  2026    Tijuana',
    );
  });

  it('defaults to Hoja1 if empty after sanitizing', () => {
    expect(sanitizeSheetName('???///:::***')).toBe('Hoja1');
    expect(sanitizeSheetName('')).toBe('Hoja1');
  });
});

describe('buildCsvContent', () => {
  it('generates valid CSV with UTF-8 BOM, escaped quotes and neutralized formulas', () => {
    const csv = buildCsvContent({
      filename: 'empresas',
      title: 'Empresas',
      columns: sampleColumns,
      rows: sampleRows,
    });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Código,Nombre Comercial,RFC,Inyección');
    expect(csv).toContain('"Maquiladora del Pacífico, S.A. de C.V."');
    expect(csv).toContain('"Tecnología ""Avanzada"""');
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+SUM(A1:B1)");
  });
});

describe('buildXlsxBlob', () => {
  it('generates a real OOXML (.xlsx) binary blob with PK magic bytes', async () => {
    const blob = await buildXlsxBlob({
      filename: 'empresas',
      title: 'Directorio de empresas registradas',
      columns: sampleColumns,
      rows: sampleRows,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(blob.size).toBeGreaterThan(1000);

    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Verificación de firma ZIP (PK\x03\x04): 0x50, 0x4b, 0x03, 0x04
    expect(uint8[0]).toBe(0x50); // P
    expect(uint8[1]).toBe(0x4b); // K
    expect(uint8[2]).toBe(0x03);
    expect(uint8[3]).toBe(0x04);
  });
});

describe('exportToCsv and exportToXlsx browser trigger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and clicks an anchor link for CSV download', () => {
    const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-csv');
    const revokeObjectURLMock = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLMock;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;

    const clickMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'a') {
        el.click = clickMock;
      }
      return el;
    });

    exportToCsv({
      filename: 'reporte-empresas',
      title: 'Empresas',
      columns: sampleColumns,
      rows: sampleRows,
    });

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(clickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-csv');
  });

  it('creates and clicks an anchor link for XLSX download', async () => {
    const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-xlsx');
    const revokeObjectURLMock = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLMock;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;

    const clickMock = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'a') {
        el.click = clickMock;
      }
      return el;
    });

    await exportToXlsx({
      filename: 'reporte-empresas',
      title: 'Empresas',
      columns: sampleColumns,
      rows: sampleRows,
    });

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(clickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-xlsx');
  });
});
