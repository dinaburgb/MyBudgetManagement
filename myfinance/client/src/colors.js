// Format a number as ILS, no decimals (e.g. 1234 → "₪1,234").
// Category colors now live in the DB and are served via the categories API
// (see CategoriesContext: colorFor).
export function ils(n) {
  const v = Math.round(Number(n) || 0)
  return `₪${v.toLocaleString('he-IL')}`
}
