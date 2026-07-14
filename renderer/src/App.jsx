import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import StatusMonitor from './components/StatusMonitor'
import UpdateNotification from './components/UpdateNotification'
import { StatusProvider } from './components/StatusContext'
import { ThemeProvider } from './components/ThemeContext'
import PostGroupPage from './pages/PostGroupPage'
import PostQueuePage from './pages/PostQueuePage'
import ProfileManagerPage from './pages/ProfileManagerPage'
import GroupManagerPage from './pages/GroupManagerPage'
import TerminalPage from './pages/TerminalPage'
import SyncQueuePage from './pages/SyncQueuePage'
import SettingsPage from './pages/SettingsPage'

function App() {
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadConfig() {
      try {
        if (window.desktopApp) {
          const cfg = await window.desktopApp.getConfig()
          setConfig(cfg)
        } else {
          setConfig({ groupUrl: 'https://facebook.com/groups/mock' })
        }
      } catch (err) {
        setError(err.message)
      }
    }
    loadConfig()
  }, [])

  if (error) {
    return (
      <div className="p-8 text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 text-center rounded-xl m-8">
        Initialization Error: {error}
      </div>
    )
  }

  if (!config) {
    return <div className="p-8 text-slate-500 dark:text-slate-400">Synchronizing with system...</div>
  }

  return (
    <ThemeProvider>
      <StatusProvider>
        <div className="flex h-screen bg-slate-100 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200 transition-colors">
          <Sidebar />
          <main className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <Routes>
                <Route path="/" element={<Navigate to="/queues" replace />} />
                <Route path="/post" element={<PostGroupPage config={config} />} />
                <Route path="/queues" element={<PostQueuePage />} />
                <Route path="/profiles" element={<ProfileManagerPage />} />
                <Route path="/terminal" element={<TerminalPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </div>
            <StatusMonitor />
          </main>
          <UpdateNotification />
        </div>
      </StatusProvider>
    </ThemeProvider>
  )
}

export default App
