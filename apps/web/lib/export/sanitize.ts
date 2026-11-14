const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutraliza celdas que comiencen con `= + - @ \t \r` anteponiendo una comilla simple `'`
 * para prevenir ataques de inyección de fórmulas en CSV y XLSX (`docs/SECURITY.md` §5).
 */
export function neutralizeFormulaCell(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  const str = String(raw);
  if (str.length === 0) {
    return '';
  }

  const firstChar = str[0];
  const trimmedFirstChar = str.trimStart()[0];

  if (
    (firstChar !== undefined && FORMULA_TRIGGERS.has(firstChar)) ||
    (trimmedFirstChar !== undefined && FORMULA_TRIGGERS.has(trimmedFirstChar))
  ) {
    return `'${str}`;
  }

  return str;
}

/**
 * Escapa un valor ya neutralizado para formato CSV RFC 4180.
 */
export function escapeCsvCell(raw: unknown): string {
  const safe = neutralizeFormulaCell(raw);
  if (
    safe.includes(',') ||
    safe.includes('"') ||
    safe.includes('\n') ||
    safe.includes('\r')
  ) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}
