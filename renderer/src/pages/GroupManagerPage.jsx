import React, { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, X, Save, Pencil, Upload, ExternalLink, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'
import { useTranslation } from 'react-i18next'

export default function GroupManagerPage() {
  const { t } = useTranslation()
  const [groups, setGroups] = useState([])
  const [busy, setBusy] = useState(false)

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [selectedIds, setSelectedIds] = useState([])

  // Import result toast
  const [importResult, setImportResult] = useState(null)

  const fileInputRef = useRef(null)

  const loadGroups = async () => {
    if (!window.desktopApp) {
      setGroups([
        { id: '1', name: 'Test Group', url: 'https://facebook.com/groups/test', createdAt: new Date().toISOString() },
      ])
      return
    }

    try {
      const data = await window.desktopApp.getGroups()
      setGroups(data)
      // Reset selection when loading new data
      setSelectedIds([])
    } catch (err) {
      console.error('Error loading group list:', err)
    }
  }

  useEffect(() => {
    loadGroups()
  }, [])

  // --- Modal handlers ---
  const openAddModal = () => {
    setEditingGroup(null)
    setFormName('')
    setFormUrl('')
    setIsModalOpen(true)
  }

  const openEditModal = (group) => {
    setEditingGroup(group)
    setFormName(group.name)
    setFormUrl(group.url)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingGroup(null)
  }

  const handleSave = async () => {
    if (!formName.trim()) return alert(t('groups.alerts.missing_name'))
    if (!formUrl.trim()) return alert(t('groups.alerts.missing_link'))

    setBusy(true)
    try {
      if (!window.desktopApp) {
        closeModal()
        return
      }

      if (editingGroup) {
        await window.desktopApp.updateGroup(editingGroup.id, {
          name: formName.trim(),
          url: formUrl.trim(),
        })
      } else {
        await window.desktopApp.addGroup({
          name: formName.trim(),
          url: formUrl.trim(),
        })
      }

      await loadGroups()
      closeModal()
    } catch (err) {
      alert(t('groups.alerts.error_saving') + err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(t('groups.alerts.delete_confirm', { name }))) return

    setBusy(true)
    try {
      if (window.desktopApp) {
        await window.desktopApp.deleteGroup(id)
        await loadGroups()
      }
    } catch (err) {
      alert(t('groups.alerts.delete_error') + err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return
    if (!confirm(t('groups.alerts.delete_multiple_confirm', { count: selectedIds.length }))) return

    setBusy(true)
    try {
      if (window.desktopApp) {
        await window.desktopApp.deleteGroups(selectedIds)
        await loadGroups()
      }
    } catch (err) {
      alert(t('groups.alerts.delete_multiple_error') + err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleToggleAll = () => {
    if (selectedIds.length === groups.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(groups.map(g => g.id))
    }
  }

  const handleToggleGroup = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  // --- Excel Import ---
  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset input to allow selecting the same file again
    e.target.value = ''

    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

      if (rows.length < 2) {
        alert(t('groups.alerts.import_no_data'))
        return
      }

      // Find name and link columns based on header row
      const header = rows[0].map((h) => String(h).toLowerCase().trim())
      const nameColIdx = header.findIndex((h) =>
        h.includes('name'),
      )
      const urlColIdx = header.findIndex((h) =>
        h.includes('link') || h.includes('url') || h.includes('group'),
      )

      if (nameColIdx === -1 || urlColIdx === -1) {
        alert(t('groups.alerts.import_missing_columns'))
        return
      }

      const parsedGroups = rows
        .slice(1)
        .filter((row) => row[nameColIdx] && row[urlColIdx])
        .map((row) => ({
          name: String(row[nameColIdx]).trim(),
          url: String(row[urlColIdx]).trim(),
        }))

      if (parsedGroups.length === 0) {
        alert(t('groups.alerts.import_no_valid_data'))
        return
      }

      if (!window.desktopApp) return

      const result = await window.desktopApp.importGroups(parsedGroups)
      await loadGroups()

      const skipped = result.total - result.addedCount
      setImportResult({
        added: result.addedCount,
        skipped,
        total: result.total,
      })

      // Automatically hide toast after 5 seconds
      setTimeout(() => setImportResult(null), 5000)
    } catch (err) {
      alert(t('groups.alerts.import_error') + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('groups.title')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">{t('groups.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={busy}
              className="btn-secondary flex items-center gap-2 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50 hover:bg-red-50 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-300"
            >
              <Trash2 className="w-5 h-5" />
              {t('groups.buttons.delete_selected')} ({selectedIds.length})
            </button>
          )}
          <button
            onClick={handleImportClick}
            disabled={busy}
            className="btn-secondary flex items-center gap-2 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 hover:text-emerald-800 dark:hover:text-emerald-300"
          >
            <FileSpreadsheet className="w-5 h-5" />
            {t('groups.buttons.import_excel')}
          </button>
          <button
            onClick={openAddModal}
            disabled={busy}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            {t('groups.buttons.add_group')}
          </button>
        </div>
      </div>

      {/* Import Result Toast */}
      {importResult && (
        <div className="mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
              {t('groups.alerts.import_success')} <strong>{importResult.added}</strong> {t('groups.alerts.new_groups')}
              {importResult.skipped > 0 && (
                <span className="text-emerald-600 dark:text-emerald-500"> · {importResult.skipped} {t('groups.alerts.skipped')}</span>
              )}
            </span>
          </div>
          <button
            onClick={() => setImportResult(null)}
            className="text-emerald-400 dark:text-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Groups Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex-1 overflow-auto transition-colors">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold z-10 transition-colors">
            <tr>
              <th className="py-4 px-6 w-12 text-center">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-500 focus:ring-blue-500 cursor-pointer w-4 h-4"
                  checked={groups.length > 0 && selectedIds.length === groups.length}
                  onChange={handleToggleAll}
                  disabled={busy || groups.length === 0}
                />
              </th>
              <th className="py-4 px-6 w-12">#</th>
              <th className="py-4 px-6">{t('groups.table.group_name')}</th>
              <th className="py-4 px-6">{t('groups.table.group_link')}</th>
              <th className="py-4 px-6 text-center w-36">{t('groups.table.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {groups.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-12 text-center text-slate-400 dark:text-slate-500 font-medium">
                  {t('groups.empty_state')}
                </td>
              </tr>
            ) : (
              groups.map((g, index) => (
                <tr key={g.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors group">
                  <td className="py-4 px-6 text-center">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-500 focus:ring-blue-500 cursor-pointer w-4 h-4"
                      checked={selectedIds.includes(g.id)}
                      onChange={() => handleToggleGroup(g.id)}
                      disabled={busy}
                    />
                  </td>
                  <td className="py-4 px-6 text-slate-400 dark:text-slate-500 text-sm">{index + 1}</td>
                  <td className="py-4 px-6 font-medium text-slate-800 dark:text-slate-200">{g.name}</td>
                  <td className="py-4 px-6">
                    <a
                      href={g.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline inline-flex items-center gap-1.5 text-sm max-w-xs truncate"
                      title={g.url}
                    >
                      {g.url}
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => openEditModal(g)}
                        disabled={busy}
                        className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4.5 h-4.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(g.id, g.name)}
                        disabled={busy}
                        className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Delete Group"
                      >
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Group count footer */}
      {groups.length > 0 && (
        <div className="mt-3 text-sm text-slate-400 dark:text-slate-500 text-right">
          {t('groups.labels.total')} <span className="font-semibold text-slate-600 dark:text-slate-300">{groups.length}</span> {t('groups.labels.groups_count_suffix')}
        </div>
      )}

      {/* Add / Edit Group Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {editingGroup ? t('groups.modal.edit_title') : t('groups.modal.add_title')}
              </h3>
              <button
                onClick={closeModal}
                disabled={busy}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('groups.modal.group_name')}</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('groups.modal.name_placeholder')}
                  disabled={busy}
                  className="input-field"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{t('groups.modal.group_link')}</label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder={t('groups.modal.link_placeholder')}
                  disabled={busy}
                  className="input-field"
                />
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3 rounded-b-2xl">
              <button
                onClick={closeModal}
                disabled={busy}
                className="btn-secondary px-5"
              >
                {t('groups.modal.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={busy || !formName.trim() || !formUrl.trim()}
                className="btn-primary px-6 flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {busy ? t('groups.modal.saving') : t('groups.modal.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
