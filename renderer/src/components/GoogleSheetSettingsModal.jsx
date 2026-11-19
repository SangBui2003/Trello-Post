import React, { useState } from 'react'
import { X, Save, CheckCircle } from 'lucide-react'

export default function GoogleSheetSettingsModal({ isOpen, onClose }) {
  const [url, setUrl] = useState(() => localStorage.getItem('googleSheetUrl') || '')
  const [showSaved, setShowSaved] = useState(false)
  const [prevOpen, setPrevOpen] = useState(isOpen)

  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen)
    if (isOpen) {
      setUrl(localStorage.getItem('googleSheetUrl') || '')
      setShowSaved(false)
    }
  }

  const handleSave = () => {
    localStorage.setItem('googleSheetUrl', url.trim())
    setShowSaved(true)
    setTimeout(() => {
      setShowSaved(false)
      onClose()
    }, 1500)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Cấu hình Google Sheets</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Dán Web App URL của Google Apps Script vào đây</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Web App URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/..."
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
            />
          </div>
          
          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800/30">
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">Hướng dẫn nhanh:</h4>
            <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-disc pl-4">
              <li>Mở file Google Sheet của bạn.</li>
              <li>Vào menu Tiện ích mở rộng {">"} Apps Script.</li>
              <li>Dán đoạn mã mình cung cấp và lưu lại.</li>
              <li>Bấm nút Triển khai (Deploy) {">"} Tùy chọn triển khai mới.</li>
              <li>Chọn loại Ứng dụng web, Quyền truy cập: "Bất kỳ ai".</li>
              <li>Copy URL của Ứng dụng web và dán vào ô bên trên.</li>
            </ul>
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary px-5">Hủy</button>
          <button
            onClick={handleSave}
            className="btn-primary px-6 flex items-center gap-2"
          >
            {showSaved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {showSaved ? 'Đã lưu!' : 'Lưu cấu hình'}
          </button>
        </div>
      </div>
    </div>
  )
}
