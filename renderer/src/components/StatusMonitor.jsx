import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Maximize2 } from 'lucide-react'
import { useStatus } from './StatusContext'
import { useTranslation } from 'react-i18next'

const LEVEL_DOT = {
  running: 'bg-amber-500 animate-pulse',
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  info: 'bg-slate-400 dark:bg-slate-500',
  idle: 'bg-slate-400 dark:bg-slate-500',
}

export default function StatusMonitor() {
  const { logs, currentLevel } = useStatus()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const latestLog = logs[0] || null
  const dotClass = LEVEL_DOT[currentLevel] || LEVEL_DOT.idle

  return (
    <div className="h-10 bg-slate-900 dark:bg-slate-950 text-slate-300 flex items-center px-4 gap-3 border-t border-slate-700/50 dark:border-slate-800 shrink-0 select-none transition-colors">
      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />

      {/* Latest log message */}
      <span className="flex-1 text-xs font-mono truncate text-slate-400 dark:text-slate-500">
        {latestLog?.time && (
          <span className="text-slate-600 dark:text-slate-700 mr-2">[{latestLog.time}]</span>
        )}
        <span className={
          currentLevel === 'running' ? 'text-amber-400' :
          currentLevel === 'success' ? 'text-emerald-400' :
          currentLevel === 'error' ? 'text-red-400' :
          'text-slate-300 dark:text-slate-400'
        }>
          {latestLog?.text ? (
            latestLog.text.includes('.') ? t(latestLog.text) : latestLog.text
          ) : t('logs.ready')}
        </span>
      </span>

      {/* Expand button */}
      <button
        onClick={() => navigate('/terminal')}
        className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 dark:hover:bg-slate-800/50 rounded transition-colors shrink-0"
        title="Expand Event Logs"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
