import React, { useState, useEffect, useCallback } from 'react'
import { Download, RefreshCw, RotateCcw, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

const STATUS = {
  IDLE: 'idle',
  CHECKING: 'checking',
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  UP_TO_DATE: 'up-to-date',
  ERROR: 'error',
}

export default function UpdateNotification() {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState({ status: STATUS.IDLE })
  const [dismissed, setDismissed] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    if (!window.desktopApp?.onUpdateStatus) return

    const cleanup = window.desktopApp.onUpdateStatus((payload) => {
      setUpdateInfo(payload)
      setDismissed(false)
    })

    return cleanup
  }, [])

  const handleCheck = useCallback(async () => {
    try {
      await window.desktopApp?.checkForUpdates()
    } catch (err) {
      // Fallback: nếu lỗi không được emit qua onUpdateStatus
      setUpdateInfo((prev) =>
        prev.status === STATUS.ERROR
          ? prev
          : { status: STATUS.ERROR, message: err?.message || t('update.check_failed') },
      )
    }
  }, [t])

  const handleDownload = useCallback(async () => {
    setIsDownloading(true)
    setUpdateInfo((prev) => ({ ...prev, status: STATUS.DOWNLOADING, percent: 0 }))
    try {
      await window.desktopApp?.downloadUpdate()
    } catch (err) {
      setUpdateInfo({
        status: STATUS.ERROR,
        message: err?.message || t('update.download_failed'),
      })
    } finally {
      setIsDownloading(false)
    }
  }, [t])

  const handleInstall = useCallback(() => {
    window.desktopApp?.installUpdate()
  }, [])

  const { status } = updateInfo

  // Helper to normalize release notes
  const renderReleaseNotes = () => {
    const { releaseName, releaseNotes } = updateInfo
    if (!releaseNotes && !releaseName) return null

    let notes = releaseNotes
    if (Array.isArray(notes)) {
      notes = notes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
    }
    if (typeof notes !== 'string') notes = ''

    return (
      <div className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 mb-4 max-h-[50vh] overflow-y-auto border border-slate-100 dark:border-slate-700/50 rounded-lg p-3 bg-slate-50 dark:bg-slate-900/30 font-sans custom-scrollbar">
        {releaseName && (
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 border-b border-slate-200 dark:border-slate-700 pb-2">{releaseName}</p>
        )}
        {notes && (
          <ReactMarkdown
            className="space-y-2"
            components={{
              p: (props) => <p className="mb-2 last:mb-0" {...props} />,
              ul: (props) => <ul className="list-disc pl-4 mb-2 space-y-1" {...props} />,
              ol: (props) => <ol className="list-decimal pl-4 mb-2 space-y-1" {...props} />,
              li: (props) => <li className="pl-1" {...props} />,
              a: (props) => <a className="text-blue-600 hover:underline" target="_blank" rel="noreferrer" {...props} />,
              strong: (props) => <strong className="font-semibold text-slate-900 dark:text-slate-100" {...props} />,
              h1: (props) => <h1 className="text-lg font-bold mt-3 mb-2" {...props} />,
              h2: (props) => <h2 className="text-base font-bold mt-3 mb-2" {...props} />,
              h3: (props) => <h3 className="text-sm font-bold mt-2 mb-1" {...props} />,
            }}
          >
            {notes}
          </ReactMarkdown>
        )}
      </div>
    )
  }

  // Don't render for idle/checking/up-to-date states, or if dismissed
  if (status === STATUS.IDLE || status === STATUS.CHECKING || status === STATUS.UP_TO_DATE) return null
  if (dismissed) return null

  return (
    <div className="fixed bottom-14 right-4 z-50 w-[400px] max-w-[90vw] animate-slide-up">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-linear-to-r from-blue-500 to-indigo-600 dark:from-blue-600 dark:to-indigo-700">
          <span className="text-sm font-semibold text-white flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${status === STATUS.DOWNLOADING ? 'animate-spin' : ''}`} />
            {t('update.available')}
          </span>
          <button
            disabled={status === STATUS.DOWNLOADING}
            onClick={() => setDismissed(true)}
            className="text-white/70 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          {status === STATUS.AVAILABLE && (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-200 mb-3">
                {t('update.version')} <span className="font-bold text-blue-600 dark:text-blue-400">{updateInfo.version}</span> {t('update.is_available')}
              </p>
              
              {renderReleaseNotes()}

              <button
                onClick={handleDownload}
                disabled={isDownloading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {isDownloading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {isDownloading ? t('update.downloading') : t('update.download_update')}
              </button>
            </>
          )}

          {status === STATUS.DOWNLOADING && (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">
                {t('update.downloading')} {updateInfo.percent?.toFixed(0)}%
              </p>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-linear-to-r from-blue-500 to-indigo-500 dark:from-blue-400 dark:to-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${updateInfo.percent || 0}%` }}
                />
              </div>
            </>
          )}

          {status === STATUS.DOWNLOADED && (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                {t('update.ready_to_install')}
              </p>
              <button
                onClick={handleInstall}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {t('update.restart_update')}
              </button>
            </>
          )}

          {status === STATUS.ERROR && (
            <>
              <p className="text-sm text-red-600 dark:text-red-400 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {updateInfo.message || t('update.failed')}
              </p>
              <button
                onClick={handleCheck}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t('update.retry')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
