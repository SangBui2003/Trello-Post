import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { ListOrdered, Terminal, Users, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const getNavItems = (t) => [
  { to: '/queues', icon: ListOrdered, label: t('sidebar.post_queue') },
  { to: '/profiles', icon: Users, label: t('sidebar.profile_manager') },
  { to: '/terminal', icon: Terminal, label: t('sidebar.event_logs') },
  { to: '/settings', icon: Settings, label: t('sidebar.settings') },
]

export default function Sidebar() {
  const [version, setVersion] = useState('')
  const { t } = useTranslation()

  useEffect(() => {
    window.desktopApp?.getAppVersion?.().then(setVersion).catch(() => {})
  }, [])

  const activeClass = 'flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 font-semibold transition-colors'
  const inactiveClass = 'flex items-center gap-3 px-4 py-3 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200 font-medium transition-colors'

  return (
    <aside className="w-64 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 transition-colors">
      <div className="p-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          🚀
          <span className='bg-clip-text bg-linear-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 text-transparent'>
            {t('sidebar.title')}
          </span>
        </h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-widest font-semibold">{t('sidebar.subtitle')}</p>
      </div>

      <nav className="flex-1 px-4 space-y-2">
        {getNavItems(t).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => isActive ? activeClass : inactiveClass}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-100 dark:border-slate-800 mt-auto flex flex-col gap-4">
        <div className="text-xs text-slate-400 dark:text-slate-500 text-center">
          {version ? `${t('sidebar.version')} ${version}` : ''}
        </div>
      </div>
    </aside>
  )
}
