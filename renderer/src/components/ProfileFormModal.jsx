import React, { useState } from 'react'
import { X, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import CookieInput from './CookieInput'

/**
 * Modal dùng chung cho cả "Thêm Profile" và "Cập nhật Token".
 *
 * @param {{
 *   mode: 'create' | 'update',
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onSubmit: (data: { name?: string, cookieString: string }) => Promise<void>,
 *   profileName?: string,   // chỉ dùng cho mode 'update' — hiển thị tên profile
 *   onError?: (msg: string) => void,
 * }} props
 */
export default function ProfileFormModal({
  mode,
  isOpen,
  onClose,
  onSubmit,
  profileId = null,
  profileName = '',
  onError,
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [cookie, setCookie] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  // Reset state mỗi khi modal mở — dùng key ở parent để remount
  const isCreate = mode === 'create'

  const handleSubmit = async () => {
    if (isCreate && !name.trim()) {
      return onError?.(t('profiles.alerts.missing_name'))
    }
    if (!cookie.trim()) {
      return onError?.(t('profiles.alerts.missing_cookie'))
    }

    setIsBusy(true)
    try {
      await onSubmit({
        ...(isCreate && { name: name.trim() }),
        cookieString: cookie,
      })
    } finally {
      setIsBusy(false)
    }
  }

  const handleClose = () => {
    if (isBusy) return
    onClose()
  }

  const title = isCreate
    ? t('profiles.modal.add_title')
    : t('profiles.modal.update_title')

  const submitLabel = isCreate
    ? t('profiles.modal.save')
    : t('profiles.modal.update')

  const submitBusyLabel = isCreate
    ? t('profiles.modal.saving')
    : t('profiles.modal.updating')

  const isSubmitDisabled = isBusy || !cookie || (isCreate && !name.trim())

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h3>
            {!isCreate && profileName && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{profileName}</p>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={isBusy}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          {isCreate && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t('profiles.modal.profile_name')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('profiles.modal.name_placeholder')}
                disabled={isBusy}
                className="input-field"
                autoFocus
              />
            </div>
          )}

          {!isCreate && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('profiles.modal.update_instruction')}
            </p>
          )}

          <CookieInput
            value={cookie}
            onChange={setCookie}
            disabled={isBusy}
            onError={onError}
            profileId={profileId}
          />
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3 rounded-b-2xl">
          <button
            onClick={handleClose}
            disabled={isBusy}
            className="btn-secondary px-5"
          >
            {t('profiles.modal.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="btn-primary px-6 flex items-center gap-2"
          >
            {isBusy ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                {submitBusyLabel}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {submitLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
