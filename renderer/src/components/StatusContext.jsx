import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const StatusContext = createContext(null)

export function StatusProvider({ children }) {
  const [logs, setLogs] = useState([])
  const [currentLevel, setCurrentLevel] = useState('idle')

  useEffect(() => {
    if (!window.desktopApp) return

    const cleanup = window.desktopApp.onStatus((payload) => {
      const time = new Date().toLocaleTimeString('en-US', { hour12: false })

      setCurrentLevel(payload.level || 'info')
      setLogs((prev) => [
        { text: payload.message, level: payload.level, time },
        ...prev,
      ])
    })

    return cleanup
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
    setCurrentLevel('idle')
  }, [])

  return (
    <StatusContext.Provider value={{ logs, currentLevel, clearLogs }}>
      {children}
    </StatusContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStatus() {
  const ctx = useContext(StatusContext)
  if (!ctx) throw new Error('useStatus must be used within StatusProvider')
  return ctx
}
