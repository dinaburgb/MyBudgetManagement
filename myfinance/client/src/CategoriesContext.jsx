import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import axios from 'axios'

// Provides the user-manageable category list (loaded from the API) to the whole
// app: names for dropdowns/filters and a color lookup for charts.
const CategoriesContext = createContext({
  categories: [], names: [], colorFor: () => '#94a3b8', reload: () => {},
})

// Palette used to give a stable, non-gray color to any category that isn't in
// the DB list yet (e.g. a scraper category we haven't mapped). Derived from the
// name so the same category always gets the same color.
const FALLBACK_PALETTE = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#f87171', '#22d3ee', '#fb923c', '#4ade80', '#e879f9',
]
function fallbackColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]
}

export function CategoriesProvider({ children }) {
  const [categories, setCategories] = useState([])

  const reload = useCallback(() => {
    return axios.get('/api/categories')
      .then(res => setCategories(res.data))
      .catch(() => {})
  }, [])

  useEffect(() => { reload() }, [reload])

  const names = categories.map(c => c.name)
  const colorMap = Object.fromEntries(categories.map(c => [c.name, c.color]))
  const colorFor = name => colorMap[name] || fallbackColor(name)

  return (
    <CategoriesContext.Provider value={{ categories, names, colorFor, reload }}>
      {children}
    </CategoriesContext.Provider>
  )
}

export const useCategories = () => useContext(CategoriesContext)
