import { describe, expect, it } from 'vitest';
import {
  generateFuenteNomenclature,
  parseFuenteNomenclature,
  FuenteAltaSchema,
} from './fuentes';

describe('fuentes contracts and nomenclature', () => {
  it('generates exact nomenclature with tenantCode, sucursalClave, and 2-digit consecutive', () => {
    expect(
      generateFuenteNomenclature({
        tenantCode: 'TIJ001',
        sucursalClave: 'MATRIZ',
        consecutivo: 1,
      }),
    ).toBe('TIJ001-MATRIZ-01');

    expect(
      generateFuenteNomenclature({
        tenantCode: 'acme',
        sucursalClave: 'suc-norte',
        consecutivo: 12,
      }),
    ).toBe('ACME-SUC-NORTE-12');
  });

  it('parses valid nomenclature strings', () => {
    const parsed = parseFuenteNomenclature('TIJ001-MATRIZ-05');
    expect(parsed).toEqual({
      tenantCode: 'TIJ001',
      sucursalClave: 'MATRIZ',
      consecutivo: 5,
    });
  });

  it('validates FuenteAltaSchema input', () => {
    const valid = FuenteAltaSchema.safeParse({
      sucursal_id: '11111111-2222-4333-8444-555555555555',
      nombre_ubicacion: 'Reloj Entrada Principal',
      marca: 'ZKTECO',
      ip_local: '192.168.1.201',
      puerto: 4370,
    });
    expect(valid.success).toBe(true);

    const invalid = FuenteAltaSchema.safeParse({
      nombre_ubicacion: 'A',
      marca: 'DESCONOCIDA',
    });
    expect(invalid.success).toBe(false);
  });
});
