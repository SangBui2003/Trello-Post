import React, { useState, useEffect } from 'react'
import {
  Plus, Trash2, X, RefreshCw, KeyRound,
  ChevronDown, ChevronUp, ExternalLink, Edit2, Check, Globe, GripVertical, Info, Download, CloudUpload, Settings, Search, Loader2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ProfileFormModal from '../components/ProfileFormModal'
import GoogleSheetSettingsModal from '../components/GoogleSheetSettingsModal'

export default function ProfileManagerPage() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [openingProfileIds, setOpeningProfileIds] = useState(new Set())
  const [runningProfileIds, setRunningProfileIds] = useState(new Set())
  const [expandedProfileId, setExpandedProfileId] = useState(null)
  const [scanningProfileId, setScanningProfileId] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Editing page name states
  const [editingPageId, setEditingPageId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [isUpdatingPage, setIsUpdatingPage] = useState(false)

  // Modal states
  const [errorStatus, setErrorStatus] = useState('')
  const [addModalKey, setAddModalKey] = useState(0)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [updateModalKey, setUpdateModalKey] = useState(0)
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false)
  const [updateProfileId, setUpdateProfileId] = useState(null)
  const [updateProfileName, setUpdateProfileName] = useState('')
  const [updateProfileMetadata, setUpdateProfileMetadata] = useState({})
  
  const [profileOrder, setProfileOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('profileOrder') || '[]') } catch { return [] }
  })
  const [draggedId, setDraggedId] = useState(null)

  const loadProfiles = async () => {
    if (!window.desktopApp) {
      setProfiles([
        {
          id: '1',
          name: 'Mock Profile 01',
          createdAt: new Date().toISOString(),
          pages: [
            { id: 'p1', pageName: 'Test Page', pageUrl: 'https://facebook.com/testpage' },
          ],
        },
      ])
      return
    }

    try {
      const data = await window.desktopApp.getProfiles()
      setProfiles(data)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadProfiles()
    if (window.desktopApp?.getRunningProfileIds) {
      window.desktopApp.getRunningProfileIds().then(ids => {
        setRunningProfileIds(new Set((ids || []).map(String)))
      }).catch(() => {})
    }
    if (window.desktopApp?.onProfileRunningUpdate) {
      const unsub = window.desktopApp.onProfileRunningUpdate(ids => {
        setRunningProfileIds(new Set((ids || []).map(String)))
      })
      return () => unsub()
    }
  }, [])

  const allOrderedProfiles = React.useMemo(() => {
    let sorted = [...profiles]
    sorted.sort((a, b) => {
      const idxA = profileOrder.indexOf(a.id)
      const idxB = profileOrder.indexOf(b.id)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return 0
    })
    return sorted
  }, [profiles, profileOrder])

  const sortedProfiles = React.useMemo(() => {
    let sorted = [...allOrderedProfiles]
    if (selectedCategory) {
      sorted = sorted.filter(p => p.metadata?.category === selectedCategory)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      sorted = sorted.filter(p => (p.name || '').toLowerCase().includes(q))
    }
    return sorted
  }, [allOrderedProfiles, selectedCategory, searchQuery])

  const handleDragStart = (e, id) => {
    if (searchQuery.trim()) return
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    setTimeout(() => {
      if (e.target) e.target.style.opacity = '0.5'
    }, 0)
  }

  const handleDragEnd = (e) => {
    if (e.target) e.target.style.opacity = '1'
    setDraggedId(null)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, targetId) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId || searchQuery.trim()) return

    const currentIndex = allOrderedProfiles.findIndex(p => p.id === draggedId)
    const targetIndex = allOrderedProfiles.findIndex(p => p.id === targetId)
    
    if (currentIndex === -1 || targetIndex === -1) return

    const newOrder = [...allOrderedProfiles]
    const [draggedItem] = newOrder.splice(currentIndex, 1)
    newOrder.splice(targetIndex, 0, draggedItem)

    const newOrderIds = newOrder.map(p => p.id)
    setProfileOrder(newOrderIds)
    localStorage.setItem('profileOrder', JSON.stringify(newOrderIds))
    setDraggedId(null)
  }

  // --- Add profile ---
  const openAddModal = () => {
    setAddModalKey((k) => k + 1)
    setIsAddModalOpen(true)
  }

  const handleCreateProfile = async ({ name, cookieString, metadata }) => {
    if (!window.desktopApp) return

    try {
      await window.desktopApp.saveProfile({ name, cookieString, metadata })
      await loadProfiles()
      setIsAddModalOpen(false)
    } catch (err) {
      setErrorStatus(t('profiles.alerts.error_saving') + err.message)
    }
  }

  // --- Update token ---
  const openUpdateModal = (profileId, profileName, metadata) => {
    setUpdateProfileId(profileId)
    setUpdateProfileName(profileName)
    setUpdateProfileMetadata(metadata || {})
    setUpdateModalKey((k) => k + 1)
    setIsUpdateModalOpen(true)
  }

  const handleUpdateToken = async ({ name, cookieString, metadata }) => {
    setBusy(true)

    try {
      await window.desktopApp.updateProfileToken(updateProfileId, name, cookieString, metadata)
      await loadProfiles()
      setIsUpdateModalOpen(false)
    } catch (err) {
      setErrorStatus(t('profiles.alerts.token_update_error') + err.message)
    } finally {
      setBusy(false)
    }
  }

  // --- Profile actions ---
  const handleDelete = async (id, name) => {
    if (!confirm(t('profiles.alerts.delete_confirm', { name }))) return
    setBusy(true)
    try {
      if (window.desktopApp) {
        await window.desktopApp.deleteProfile(id)
        await loadProfiles()
      }
    } catch (err) {
      setErrorStatus(t('profiles.alerts.delete_error') + err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleOpenProfile = async (profileId) => {
    setOpeningProfileIds(prev => new Set(prev).add(profileId))
    try {
      if (window.desktopApp) {
        await window.desktopApp.openProfile(profileId)
      }
    } catch (err) {
      setErrorStatus("Lỗi mở Profile: " + err.message)
    } finally {
      setOpeningProfileIds(prev => {
        const next = new Set(prev)
        next.delete(profileId)
        return next
      })
    }
  }

  const handleScanPages = async (profileId) => {
    setScanningProfileId(profileId)
    try {
      if (window.desktopApp) {
        await window.desktopApp.scanProfilePages(profileId)
        await loadProfiles()
        setExpandedProfileId(profileId)
      }
    } catch (err) {
      setErrorStatus(t('profiles.alerts.page_scan_error') + err.message)
    } finally {
      setScanningProfileId(null)
    }
  }

  // --- Page editing ---
  const toggleExpand = (profileId) => {
    setExpandedProfileId((prev) => (prev === profileId ? null : profileId))
  }

  const startEditingPage = (page) => {
    setEditingPageId(page.id)
    setEditingName(page.pageName)
  }

  const cancelEditingPage = () => {
    setEditingPageId(null)
    setEditingName('')
  }

  const savePageName = async (profileId, pageId) => {
    if (!editingName.trim()) return setErrorStatus(t('profiles.alerts.page_name_empty'))
    setErrorStatus('')

    setIsUpdatingPage(true)
    try {
      if (window.desktopApp) {
        await window.desktopApp.updatePageName(profileId, pageId, editingName.trim())
        await loadProfiles()
        setEditingPageId(null)
      }
    } catch (err) {
      setErrorStatus(t('profiles.alerts.page_update_error') + err.message)
    } finally {
      setIsUpdatingPage(false)
    }
  }

  const handleExportExcel = async () => {
    if (!window.desktopApp) return;
    setBusy(true);
    try {
      const profileIds = sortedProfiles.map(p => p.id);
      const filePath = await window.desktopApp.exportProfilesToExcel(profileIds);
      if (filePath) {
        setErrorStatus(`Đã xuất file Excel thành công: ${filePath}`);
        setTimeout(() => setErrorStatus(''), 5000);
      }
    } catch (error) {
      setErrorStatus(`Lỗi khi xuất Excel: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const [isSheetModalOpen, setIsSheetModalOpen] = useState(false)

  const handleSyncSheets = async () => {
    const webAppUrl = localStorage.getItem('googleSheetUrl')
    if (!webAppUrl) {
      setIsSheetModalOpen(true)
      return
    }

    if (!window.desktopApp) return;
    setBusy(true);
    try {
      const profileIds = allOrderedProfiles.map(p => p.id);
      const res = await window.desktopApp.syncProfilesToSheets(profileIds, webAppUrl);
      if (res.success) {
        setErrorStatus(`Đồng bộ thành công: ${res.message}`);
        setTimeout(() => setErrorStatus(''), 5000);
      } else {
        setErrorStatus(`Lỗi đồng bộ: ${res.message}`);
      }
    } catch (error) {
      if (error.message.includes('fetch')) {
        setErrorStatus('Lỗi mạng hoặc URL Web App không hợp lệ. Vui lòng kiểm tra lại cấu hình.');
      } else {
        setErrorStatus(`Lỗi khi đồng bộ Google Sheets: ${error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('profiles.title')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">{t('profiles.subtitle')}</p>
        </div>
        {errorStatus && (
          <div className="mx-4 flex-1 p-3 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm rounded-lg flex justify-between items-center animate-in fade-in slide-in-from-top-2">
            <span><strong>{t('post_group.alerts.error_prefix')}</strong> {errorStatus}</span>
            <button onClick={() => setErrorStatus('')} className="text-red-400 hover:text-red-600 dark:hover:text-red-300">✕</button>
          </div>
        )}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Search Input */}
            <div className="relative group/search">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within/search:text-blue-500 transition-colors" />
              <input
                type="text"
                placeholder={t('profiles.search_placeholder') || 'Tìm kiếm theo tên...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-48 focus:w-60"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded transition-colors"
                  title="Xoá tìm kiếm"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="input-field max-w-[200px] text-sm py-2"
            >
              <option value="">Tất cả danh mục</option>
              <option value="adm">Admin</option>
              <option value="btv">BTV</option>
            </select>
            <button
              onClick={handleExportExcel}
              disabled={busy || sortedProfiles.length === 0}
              className="btn-secondary flex items-center gap-2"
              title="Xuất danh sách ra Excel"
            >
              <Download className="w-5 h-5" />
              Xuất Excel
            </button>
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button
                onClick={handleSyncSheets}
                disabled={busy || allOrderedProfiles.length === 0}
                className="px-3 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:bg-white dark:hover:bg-slate-700 rounded flex items-center gap-2 transition-colors disabled:opacity-50"
                title="Đồng bộ danh sách lên Google Sheets"
              >
                <CloudUpload className="w-4 h-4" />
                Đồng bộ Sheet
              </button>
              <button
                onClick={() => setIsSheetModalOpen(true)}
                disabled={busy}
                className="px-2 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-white dark:hover:bg-slate-700 rounded transition-colors"
                title="Cấu hình Google Sheets"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={openAddModal}
              disabled={busy}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {t('profiles.buttons.add_profile')}
            </button>
          </div>
        </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex-1 overflow-auto transition-colors">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold z-10 transition-colors">
            <tr>
              <th className="py-4 pl-6 pr-2 w-12 text-center text-slate-400">#</th>
              <th className="py-4 px-6">{t('profiles.table.profile_name')}</th>
              <th className="py-4 px-6">{t('profiles.table.date_added')}</th>
              <th className="py-4 px-6 text-center w-24">{t('profiles.table.pages')}</th>
              <th className="py-4 px-6 text-center w-40">{t('profiles.table.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sortedProfiles.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-12 text-center text-slate-400 dark:text-slate-500 font-medium">
                  {searchQuery.trim() ? (t('profiles.no_search_results') || 'Không tìm thấy Profile nào phù hợp.') : t('profiles.empty_state')}
                </td>
              </tr>
            ) : (
              sortedProfiles.map((p, index) => {
                const pageCount = p.pages?.length || 0
                const isExpanded = expandedProfileId === p.id
                const isScanning = scanningProfileId === p.id
                const hasMetadata = p.metadata && (p.metadata.uid || p.metadata.password || p.metadata.twofa || p.metadata.email || p.metadata.emailPass || p.metadata.rawString || p.metadata.category)

                return (
                  <React.Fragment key={p.id}>
                    <tr 
                      className={`hover:bg-slate-200 dark:hover:bg-slate-700/50 transition-colors group/row cursor-pointer ${draggedId === p.id ? 'opacity-50' : ''}`}
                      draggable={!searchQuery.trim()}
                      onDragStart={(e) => handleDragStart(e, p.id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, p.id)}
                    >
                      <td className="py-4 pl-6 pr-2 text-center font-bold text-slate-400 dark:text-slate-500 w-12 shrink-0">
                        {index + 1}
                      </td>
                      <td className="py-4 px-6 font-medium text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-2">
                          {!searchQuery.trim() && (
                            <GripVertical className="w-4 h-4 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0" />
                          )}
                          <span className="truncate">{p.name}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-slate-500 dark:text-slate-400">
                        {new Date(p.createdAt).toLocaleDateString('vi-VN', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {(pageCount > 0 || hasMetadata) ? (
                          <button
                            onClick={() => toggleExpand(p.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                          >
                            {pageCount > 0 ? pageCount : <Info className="w-4 h-4" />}
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 text-sm">0</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {(() => {
                            const isRunning = runningProfileIds.has(String(p.id))
                            const isOpening = openingProfileIds.has(p.id)
                            return (
                              <button
                                onClick={() => handleOpenProfile(p.id)}
                                disabled={busy || isOpening}
                                className={`p-2 rounded-lg transition-all relative ${
                                  isRunning
                                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 ring-1 ring-emerald-500/40'
                                    : 'text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                                }`}
                                title={
                                  isOpening
                                    ? 'Đang khởi chạy trình duyệt...'
                                    : isRunning
                                    ? 'Trình duyệt đang mở - Bấm để chuyển đến cửa sổ'
                                    : 'Mở trình duyệt với Profile này'
                                }
                              >
                                {isOpening ? (
                                  <Loader2 className="w-4.5 h-4.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Globe className="w-4.5 h-4.5" />
                                )}
                                {isRunning && !isOpening && (
                                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900 animate-pulse" />
                                )}
                              </button>
                            )
                          })()}
                          <button
                            onClick={() => openUpdateModal(p.id, p.name, p.metadata)}
                            disabled={busy}
                            className="p-2 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                            title={t('profiles.tooltips.update_token')}
                          >
                            <KeyRound className="w-4.5 h-4.5" />
                          </button>
                          <button
                            onClick={() => handleScanPages(p.id)}
                            disabled={isScanning || busy}
                            className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                            title={t('profiles.tooltips.rescan')}
                          >
                            <RefreshCw className={`w-4.5 h-4.5 ${isScanning ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleDelete(p.id, p.name)}
                            disabled={busy}
                            className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title={t('profiles.tooltips.delete')}
                          >
                            <Trash2 className="w-4.5 h-4.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Pages Row */}
                    {isExpanded && (pageCount > 0 || hasMetadata) && (
                      <tr>
                        <td colSpan="5" className="bg-slate-50/70 dark:bg-slate-800/30 px-6 py-4">
                          <div className="ml-4 space-y-4">
                            {hasMetadata && (
                              <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Thông tin tài khoản</p>
                                <div className="flex gap-4 items-center flex-wrap bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                                  {p.metadata.uid && (
                                    <div className="text-sm"><span className="text-slate-500 dark:text-slate-400">UID: </span><span className="font-medium text-slate-800 dark:text-slate-200">{p.metadata.uid}</span></div>
                                  )}
                                  {p.metadata.password && (
                                    <div className="text-sm"><span className="text-slate-500 dark:text-slate-400">Pass: </span><span className="font-medium text-slate-800 dark:text-slate-200">{p.metadata.password}</span></div>
                                  )}
                                  {p.metadata.twofa && (
                                    <div className="text-sm"><span className="text-slate-500 dark:text-slate-400">2FA: </span><span className="font-medium text-slate-800 dark:text-slate-200">{p.metadata.twofa}</span></div>
                                  )}
                                  {p.metadata.email && (
                                    <div className="text-sm"><span className="text-slate-500 dark:text-slate-400">Email: </span><span className="font-medium text-slate-800 dark:text-slate-200">{p.metadata.email}</span></div>
                                  )}
                                  {p.metadata.emailPass && (
                                    <div className="text-sm"><span className="text-slate-500 dark:text-slate-400">MK Email: </span><span className="font-medium text-slate-800 dark:text-slate-200">{p.metadata.emailPass}</span></div>
                                  )}
                                  {p.metadata.rawString && (
                                    <div className="text-sm truncate" title={p.metadata.rawString}><span className="text-slate-500 dark:text-slate-400">Cookie: </span><span className="font-medium text-slate-800 dark:text-slate-200 truncate">{p.metadata.rawString.substring(0, 30)}...</span></div>
                                  )}
                                  {p.metadata.category && (
                                    <div className="text-sm">
                                      <span className="text-slate-500 dark:text-slate-400">Danh mục: </span>
                                      <span className="font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                                        {p.metadata.category === 'adm' ? 'Admin' : p.metadata.category === 'btv' ? 'BTV' : p.metadata.category}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {pageCount > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t('profiles.labels.fanpage_list')}</p>
                            {p.pages.map((pg) => {
                              const isEditing = editingPageId === pg.id;
                              return (
                                <div key={pg.id} className="flex items-center gap-3 py-1.5 px-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 group">
                                  {isEditing ? (
                                    <div className="flex items-center gap-2 flex-1">
                                      <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        className="flex-1 py-1 px-2 text-sm border border-blue-300 dark:border-blue-700 bg-transparent text-slate-800 dark:text-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') savePageName(p.id, pg.id);
                                          if (e.key === 'Escape') cancelEditingPage();
                                        }}
                                      />
                                      <button
                                        onClick={() => savePageName(p.id, pg.id)}
                                        disabled={isUpdatingPage}
                                        className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 rounded transition-colors"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={cancelEditingPage}
                                        disabled={isUpdatingPage}
                                        className="p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 rounded transition-colors"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <span className="font-medium text-slate-700 dark:text-slate-300 text-sm flex-1">{pg.pageName}</span>
                                      <button
                                        onClick={() => startEditingPage(pg)}
                                        disabled={busy}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
                                        title={t('profiles.tooltips.edit_name')}
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <a
                                        href={pg.pageUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline text-xs inline-flex items-center gap-1 truncate max-w-[200px]"
                                        title={pg.pageUrl}
                                      >
                                        {pg.pageUrl}
                                        <ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
                                    </>
                                  )}
                                </div>
                              )
                            })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add Profile Modal */}
      <ProfileFormModal
        key={addModalKey}
        mode="create"
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleCreateProfile}
        onError={setErrorStatus}
      />

      {/* Update Token Modal */}
      <ProfileFormModal
        key={`update-${updateModalKey}`}
        mode="update"
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
        onSubmit={handleUpdateToken}
        profileId={updateProfileId}
        profileName={updateProfileName}
        initialMetadata={updateProfileMetadata}
        onError={setErrorStatus}
      />
      <GoogleSheetSettingsModal
        isOpen={isSheetModalOpen}
        onClose={() => setIsSheetModalOpen(false)}
      />
    </div>
  )
}
