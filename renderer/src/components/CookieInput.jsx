import React, { useState } from 'react'
import { KeyRound, ClipboardPaste } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Parse J2Team Extension JSON → internal cookie format.
 * J2Team exports: array of { name, value, domain, path, ... }
 * App expects: JSON string `{ cookies: [...] }`
 */
function parseJ2TeamCookies(rawText) {
  const parsed = JSON.parse(rawText)

  // J2Team trả về mảng trực tiếp
  if (Array.isArray(parsed)) {
    const isValid = parsed.length > 0 && parsed[0].name && parsed[0].value
    if (!isValid) return null

    return JSON.stringify({ cookies: parsed })
  }

  // Trường hợp đã wrap sẵn `{ cookies: [...] }`
  if (parsed.cookies && Array.isArray(parsed.cookies)) {
    return JSON.stringify(parsed)
  }

  return null
}

/**
 * Reusable cookie/token input component with 2 tabs:
 * - Browser: mở Chromium để đăng nhập lấy cookie
 * - J2Team: dán JSON cookies từ J2Team Extension
 *
 * @param {{ value: string, onChange: (v: string) => void, disabled: boolean, onError: (msg: string) => void }} props
 */
export default function CookieInput({ value, onChange, disabled = false, onError }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('browser')
  const [pasteInput, setPasteInput] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)

  const handleExtractFromBrowser = async () => {
    setIsExtracting(true)
    try {
      if (window.desktopApp) {
        const cookieString = await window.desktopApp.startProfileLogin()
        if (cookieString) {
          onChange(cookieString)
        }
      } else {
        setTimeout(() => onChange('{"mock": "cookie-data"}'), 1000)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsExtracting(false)
    }
  }

  const handlePasteJ2Team = () => {
    if (!pasteInput.trim()) return

    try {
      const converted = parseJ2TeamCookies(pasteInput.trim())
      if (!converted) {
        return onError?.(t('profiles.alerts.invalid_j2team_format'))
      }
      onChange(converted)
      onError?.('')
    } catch {
      onError?.(t('profiles.alerts.invalid_j2team_format'))
    }
  }

  const handleReset = () => {
    onChange('')
    setPasteInput('')
  }

  const isBusy = disabled || isExtracting

  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
        {t('profiles.modal.extract_cookie')}
      </label>

      {/* Tab selector */}
      <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1 gap-1 mb-4">
        <button
          onClick={() => setActiveTab('browser')}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'browser'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <KeyRound className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          {t('profiles.modal.tab_browser')}
        </button>
        <button
          onClick={() => setActiveTab('paste')}
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'paste'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <ClipboardPaste className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          {t('profiles.modal.tab_paste')}
        </button>
      </div>

      {/* Browser tab */}
      {activeTab === 'browser' && (
        <div>
          {!value ? (
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center">
              <KeyRound className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 px-4">
                {t('profiles.modal.extract_instruction')}
              </p>
              <button
                onClick={handleExtractFromBrowser}
                disabled={isBusy}
                className="btn-secondary w-full py-3 flex items-center justify-center gap-2 font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-blue-200 dark:border-blue-800/50"
              >
                {isExtracting ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                    {t('profiles.modal.waiting_login')}
                  </>
                ) : (
                  <>{t('profiles.modal.open_browser')}</>
                )}
              </button>
            </div>
          ) : (
            <CookieSuccess value={value} onReset={handleReset} disabled={isBusy} />
          )}
        </div>
      )}

      {/* Paste J2Team tab */}
      {activeTab === 'paste' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('profiles.modal.paste_instruction')}
          </p>
          <textarea
            rows={6}
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            placeholder={t('profiles.modal.paste_placeholder')}
            disabled={isBusy}
            className="input-field text-xs font-mono"
          />
          {!value && pasteInput.trim() && (
            <button
              onClick={handlePasteJ2Team}
              disabled={isBusy}
              className="btn-secondary w-full py-2.5 flex items-center justify-center gap-2 font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-blue-200 dark:border-blue-800/50"
            >
              <ClipboardPaste className="w-4 h-4" />
              {t('profiles.modal.tab_paste')}
            </button>
          )}
          {value && (
            <CookieSuccess value={value} onReset={handleReset} disabled={isBusy} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Hiển thị trạng thái cookie đã lấy thành công.
 */
function CookieSuccess({ onReset, disabled }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-lg p-3 text-sm text-emerald-700 dark:text-emerald-400 flex items-start gap-2 font-medium">
        <span className="text-emerald-500 dark:text-emerald-400 font-bold">✓</span>
        {t('profiles.modal.cookie_success')}
      </div>
      <div className="text-right">
        <button
          onClick={onReset}
          disabled={disabled}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
        >
          {t('profiles.modal.get_different')}
        </button>
      </div>
    </div>
  )
}
