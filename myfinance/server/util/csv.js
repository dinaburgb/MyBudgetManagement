/**
 * Quote a value for a CSV cell and neutralise spreadsheet formula injection:
 * a field starting with = + - @ (or tab/CR) is prefixed with a single quote so
 * Excel/Google Sheets treat it as text, not an executable formula.
 */
export function csvSafeText(value) {
  const s = String(value ?? '')
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}
