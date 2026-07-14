import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Download, Trash2, Terminal, Check } from 'lucide-react'
import { useStatus } from '../components/StatusContext'
import { useTranslation } from 'react-i18next'

const LEVEL_BADGE = {
  running: 'bg-amber-900/40 text-amber-400 border-amber-800/50',
  success: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50',
  error: 'bg-red-900/40 text-red-400 border-red-800/50',
  info: 'bg-slate-800 text-slate-400 border-slate-700',
}

export default function TerminalPage() {
  const { t } = useTranslation()
  const { logs, clearLogs } = useStatus()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const logsText = useMemo(() => {
    return logs
      .map((log) => {
        const translatedText = log.text && log.text.includes('.') ? t(log.text) : log.text
        return `[${log.time || '--'}] [${(log.level || 'info').toUpperCase()}] ${translatedText}`
      })
      .join('\n')
  }, [logs, t])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logsText)
      setCopied(true)
      setTimeout(() => setCopied(false), 700)
    } catch {
      // fallback
      const textarea = document.createElement('textarea')
      textarea.value = logsText
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 700)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([logsText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terminal-log-${new Date().toISOString().slice(0, 10)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClear = () => {
    if (!confirm(t('logs.clear_confirm'))) return
    clearLogs()
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-300">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Terminal className="w-5 h-5 text-emerald-500" />
          <h2 className="text-lg font-bold text-white">{t('logs.title')}</h2>
          <span className="text-xs text-slate-500 font-mono bg-slate-800 px-2.5 py-1 rounded">
            {logs.length} {t('logs.lines')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={logs.length === 0}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-200 disabled:opacity-30 disabled:pointer-events-none ${
              copied 
                ? 'text-emerald-400 bg-emerald-900/30 ring-1 ring-emerald-500/50' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t('logs.copied') : t('logs.copy')}
          </button>
          <button
            onClick={handleDownload}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <Download className="w-3.5 h-3.5" />
            {t('logs.download')}
          </button>
          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-400/70 hover:text-red-400 hover:bg-red-950/50 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('logs.clear_logs')}
          </button>
        </div>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed space-y-0.5">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-600">
            {t('logs.no_logs')}
          </div>
        ) : (
          logs.map((log, idx) => {
            const badgeClass = LEVEL_BADGE[log.level] || LEVEL_BADGE.info

            return (
              <div
                key={idx}
                className="flex items-start gap-3 py-1.5 px-3 rounded hover:bg-slate-900/50 transition-colors group"
              >
                <span className="text-slate-600 shrink-0 text-xs mt-0.5 w-16">
                  {log.time || '--:--:--'}
                </span>
                <span className={`shrink-0 text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border mt-0.5 ${badgeClass}`}>
                  {log.level || 'info'}
                </span>
                <span className={
                  log.level === 'running' ? 'text-amber-300' :
                  log.level === 'success' ? 'text-emerald-300' :
                  log.level === 'error' ? 'text-red-300' :
                  'text-slate-300'
                }>
                  {log.text && log.text.includes('.') ? t(log.text) : log.text}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
