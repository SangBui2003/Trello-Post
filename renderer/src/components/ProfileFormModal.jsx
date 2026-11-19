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
  initialMetadata = {},
  onError,
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(profileName)
  const [cookie, setCookie] = useState('')
  const [metadata, setMetadata] = useState(initialMetadata)
  const [isBusy, setIsBusy] = useState(false)

  // Reset state mỗi khi modal mở — dùng key ở parent để remount
  const isCreate = mode === 'create'

  const handleSubmit = async () => {
    if (!name.trim()) {
      return onError?.(t('profiles.alerts.missing_name'))
    }

    setIsBusy(true)
    try {
      await onSubmit({
        name: name.trim(),
        cookieString: cookie,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
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
    ? 'Lưu và mở Facebook'
    : t('profiles.modal.update')

  const submitBusyLabel = isCreate
    ? t('profiles.modal.saving')
    : t('profiles.modal.updating')

  const isSubmitDisabled = isBusy || !name.trim()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h3>
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
              autoFocus={isCreate}
            />
          </div>

          {isCreate ? (
            <p className="text-sm text-slate-600 dark:text-slate-400 rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
              Chỉ cần đặt tên và bấm "Lưu và mở Facebook". Trình duyệt sẽ tự mở trang Facebook, không cần lấy hoặc dán Cookie trước.
              Nếu điền UID và mật khẩu bên dưới, phần mềm sẽ thử đăng nhập tự động; nếu không, bạn có thể đăng nhập ngay trong trình duyệt.
              Phiên đăng nhập sẽ được lưu lại cho Profile này.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Cập nhật lại Token nếu Cookie cũ bị hết hạn. Có thể bỏ trống nếu chỉ muốn sửa tên.
              </p>
              <CookieInput
                value={cookie}
                onChange={setCookie}
                onMetadataChange={(m) => setMetadata(prev => ({ ...prev, ...m }))}
                disabled={isBusy}
                onError={onError}
                profileId={profileId}
              />
            </>
          )}

          <div className="pt-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Thông tin đăng nhập bổ sung (Tùy chọn)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="UID"
                value={metadata.uid || ''}
                onChange={e => setMetadata(prev => ({ ...prev, uid: e.target.value }))}
                className="input-field text-sm py-2"
                disabled={isBusy}
              />
              <input
                type="password"
                placeholder="Mật khẩu"
                value={metadata.password || ''}
                onChange={e => setMetadata(prev => ({ ...prev, password: e.target.value }))}
                className="input-field text-sm py-2"
                disabled={isBusy}
              />
              <input
                type="text"
                placeholder="2FA"
                value={metadata.twofa || ''}
                onChange={e => setMetadata(prev => ({ ...prev, twofa: e.target.value }))}
                className="input-field text-sm py-2"
                disabled={isBusy}
              />
              <input
                type="text"
                placeholder="Email"
                value={metadata.email || ''}
                onChange={e => setMetadata(prev => ({ ...prev, email: e.target.value }))}
                className="input-field text-sm py-2"
                disabled={isBusy}
              />
              <input
                type="password"
                placeholder="Mật khẩu Email"
                value={metadata.emailPass || ''}
                onChange={e => setMetadata(prev => ({ ...prev, emailPass: e.target.value }))}
                className="input-field text-sm py-2"
                disabled={isBusy}
              />
              {!isCreate && (
                <input
                  type="text"
                  placeholder="Cookie (Chuỗi đầy đủ)"
                  value={metadata.rawString || ''}
                  onChange={e => setMetadata(prev => ({ ...prev, rawString: e.target.value }))}
                  className="input-field text-sm py-2"
                  disabled={isBusy}
                />
              )}
              <select
                value={metadata.category || ''}
                onChange={e => setMetadata(prev => ({ ...prev, category: e.target.value }))}
                className="input-field text-sm py-2"
                disabled={isBusy}
              >
                <option value="">Chọn danh mục (Trống)</option>
                <option value="adm">Admin</option>
                <option value="btv">BTV</option>
              </select>
            </div>
          </div>
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
