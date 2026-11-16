import { describe, expect, it } from 'vitest';
import { escapeCsvCell, neutralizeFormulaCell } from './sanitize';

describe('Formula Injection Sanitization (CSV / XLSX)', () => {
  it('prefixes cells starting with =, +, -, @, tab or carriage return with a single quote', () => {
    expect(neutralizeFormulaCell('=CMD|\' /C calc\'!A0')).toBe(
      '\'=CMD|\' /C calc\'!A0',
    );
    expect(neutralizeFormulaCell('+SUM(A1:A10)')).toBe("'+SUM(A1:A10)");
    expect(neutralizeFormulaCell('-2+3+cmd')).toBe("'-2+3+cmd");
    expect(neutralizeFormulaCell('@SUM(1+1)')).toBe("'@SUM(1+1)");
    expect(neutralizeFormulaCell('\t=1+1')).toBe("'\t=1+1");
    expect(neutralizeFormulaCell('   =HYPERLINK("http://evil.tld")')).toBe(
      "'   =HYPERLINK(\"http://evil.tld\")",
    );
  });

  it('leaves normal Mexican text, RFCs and numbers intact', () => {
    expect(neutralizeFormulaCell('Maquiladora del Pacífico')).toBe(
      'Maquiladora del Pacífico',
    );
    expect(neutralizeFormulaCell('MPA010101ABC')).toBe('MPA010101ABC');
    expect(neutralizeFormulaCell(1250.5)).toBe('1250.5');
    expect(neutralizeFormulaCell(null)).toBe('');
  });

  it('escapes commas and double quotes in CSV cells while preserving formula neutralization', () => {
    expect(escapeCsvCell('=1+1, "peligro"')).toBe('"\'=1+1, ""peligro"""');
    expect(escapeCsvCell('Tijuana, B.C.')).toBe('"Tijuana, B.C."');
  });
});
