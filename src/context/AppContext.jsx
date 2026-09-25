// Auth + toast state.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/index.js'
import { getToken, getUser, setSession, clearSession, USE_MOCK } from '../api/client.js'
import { landingPath } from '../lib/roles.js'
import { initialTheme, applyTheme } from '../lib/theme.js'
import Icon from '../lib/icons.jsx'

const Ctx = createContext(null)

export function useApp() {
  return useContext(Ctx)
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => getUser())
  const [toasts, setToasts] = useState([])
  const [theme, setThemeState] = useState(initialTheme)
  const idRef = useRef(0)

  // Apply the chosen theme to <html> + persist it (Login / Profile toggles).
  useEffect(() => { applyTheme(theme) }, [theme])

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const toast = useCallback((message, type = 'success', ms = 3400) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms)
  }, [])

  // keep session alive: revalidate on mount
  useEffect(() => {
    if (!user || !getToken()) return
    api.auth.me()
      .then((r) => setUser(r.user))
      .catch(() => {
        clearSession()
        setUser(null)
      })
  }, [])

  const login = useCallback(async (email, password) => {
    const r = await api.auth.login(email, password)
    setSession(r.token, r.user)
    setUser(r.user)
    return r.user
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
    location.hash = '#/login'
  }, [])

  const updateUser = useCallback((u) => {
    const next = { ...getUser(), ...u }
    setSession(getToken(), next)
    setUser(next)
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthed: !!user && !!getToken(),
      login,
      logout,
      updateUser,
      toast,
      useMock: USE_MOCK,
      landing: user ? landingPath(user.role) : '/login',
      theme,
      toggleTheme,
    }),
    [user, login, logout, updateUser, toast, theme, toggleTheme]
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <Icon name={t.type === 'success' ? 'check-circle' : t.type === 'error' ? 'alert' : 'info'} size={17} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
