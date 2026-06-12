import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import axios from 'axios'

// Provides the user-manageable category list (loaded from the API) to the whole
// app: names for dropdowns/filters and a color lookup for charts.
const CategoriesContext = createContext({
  categories: [], names: [], colorFor: () => '#94a3b8', reload: () => {},
})

const FALLBACK_COLOR = '#94a3b8'

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
  const colorFor = name => colorMap[name] || FALLBACK_COLOR

  return (
    <CategoriesContext.Provider value={{ categories, names, colorFor, reload }}>
      {children}
    </CategoriesContext.Provider>
  )
}

export const useCategories = () => useContext(CategoriesContext)
