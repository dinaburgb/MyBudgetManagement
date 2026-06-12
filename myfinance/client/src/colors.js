// A pleasant, high-contrast palette for charts, plus a stable color per category
// so the same category keeps its color across the pie, bars, and budget bars.
export const PALETTE = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#f87171', '#22d3ee', '#fb923c', '#4ade80', '#e879f9',
  '#2dd4bf', '#facc15', '#818cf8', '#fca5a5', '#94a3b8',
]

import { CATEGORIES } from './categories.js'

// Map each canonical category to a fixed palette color.
export const CATEGORY_COLOR = Object.fromEntries(
  CATEGORIES.map((c, i) => [c, PALETTE[i % PALETTE.length]])
)

export function colorFor(category) {
  return CATEGORY_COLOR[category] || '#94a3b8'
}

// Format a number as ILS, no decimals (e.g. 1234 → "₪1,234").
export function ils(n) {
  const v = Math.round(Number(n) || 0)
  return `₪${v.toLocaleString('he-IL')}`
}
