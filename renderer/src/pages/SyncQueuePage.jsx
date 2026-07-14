import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListOrdered,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  X,
  History,
  Clock,
  CheckCircle2,
  AlertCircle,
  Zap,
  RotateCcw,
  Users,
  Save,
} from 'lucide-react'

const EMPTY_FORM = {
  name: '',
  profileId: '',
  pageIdentity: 'personal',
  groupIds: [],
  delayMinutes: 1,
}

function extractErrorMessage(error) {
  if (!error || !error.message) return 'Unknown error';
  return error.message.replace(/Error invoking remote method '[^']+':\s*Error:\s*/, '').replace(/Error:\s*/, '');
}

function formatDate(value) {
  if (!value) return '--'
  return new Date(value).toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function SyncQueuePage() {
  const { t } = useTranslation()
  const [queues, setQueues] = useState([])
  const [profiles, setProfiles] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningIds, setRunningIds] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingQueue, setEditingQueue] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errorStatus, setErrorStatus] = useState('')
  const [showLogsId, setShowLogsId] = useState(null)

  const hasDesktopBridge = Boolean(window.desktopApp)

  // --- Data loading ---

  const loadData = useCallback(async (isSilent = false) => {
    if (!hasDesktopBridge) {
      if (!isSilent) setLoading(false)
      return
    }

    if (!isSilent) setLoading(true)
    try {
      const [queueData, profileData, groupData, runningData] = await Promise.all([
        window.desktopApp.getSyncQueues(),
        window.desktopApp.getProfiles(),
        window.desktopApp.getGroups(),
        window.desktopApp.getRunningSyncQueueIds(),
      ])

      setQueues(queueData || [])
      setProfiles(profileData || [])
      setGroups(groupData || [])
      setRunningIds(runningData || [])
    } catch (error) {
      console.error('Data load error:', error)
      if (!isSilent) setErrorStatus(`Data load error: ${extractErrorMessage(error)}`)
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [hasDesktopBridge])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!hasDesktopBridge) return undefined

    return window.desktopApp.onSyncQueueRunningUpdate((ids) => {
      setRunningIds(ids || [])
      loadData(true)
    })
  }, [hasDesktopBridge, loadData])

  // Real-time sync queue data updates from backend
  useEffect(() => {
    if (!hasDesktopBridge) return undefined

    return window.desktopApp.onSyncQueueDataUpdate(({ id, queue: updatedQueue }) => {
      setQueues((prev) =>
        prev.map((q) => (q.id === id ? updatedQueue : q)),
      )
    })
  }, [hasDesktopBridge])

  // --- Derived state ---

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === form.profileId) || null,
    [form.profileId, profiles],
  )

  const availablePages = selectedProfile?.pages || []
  const readyProfiles = profiles.length > 0
  const readyGroups = groups.length > 0

  // --- Form handlers ---

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingQueue(null)
  }

  const openAddModal = () => {
    resetForm()
    setErrorStatus('')
    setIsModalOpen(true)
  }

  const openEditModal = (queue) => {
    setEditingQueue(queue)
    setForm({
      name: queue.name || '',
      profileId: queue.profileId || '',
      pageIdentity: queue.pageIdentity || 'personal',
      groupIds: Array.isArray(queue.groupIds) ? queue.groupIds : [],
      delayMinutes: queue.delayMinutes || 1,
    })
    setErrorStatus('')
    setIsModalOpen(true)
  }

  const dismissModal = () => {
    setIsModalOpen(false)
    resetForm()
  }

  const closeModal = () => {
    if (saving) return
    dismissModal()
  }

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleProfileChange = (profileId) => {
    const profile = profiles.find((item) => item.id === profileId)
    const nextPageIdentity =
      form.pageIdentity !== 'personal' && profile?.pages?.some((page) => page.pageUrl === form.pageIdentity)
        ? form.pageIdentity
        : 'personal'

    setForm((prev) => ({
      ...prev,
      profileId,
      pageIdentity: nextPageIdentity,
    }))
  }

  const toggleGroupSelection = (groupId) => {
    setForm((prev) => ({
      ...prev,
      groupIds: prev.groupIds.includes(groupId)
        ? prev.groupIds.filter((id) => id !== groupId)
        : [...prev.groupIds, groupId],
    }))
  }

  const validateForm = () => {
    if (!form.name.trim()) return t('sync_queue.modal.alerts.missing_name')
    if (!form.profileId) return t('sync_queue.modal.alerts.missing_profile')
    if (form.groupIds.length === 0) return t('sync_queue.modal.alerts.min_groups')
    if (form.delayMinutes < 0) return t('sync_queue.modal.alerts.invalid_delay')
    return ''
  }

  const handleSave = async () => {
    const validationError = validateForm()
    if (validationError) {
      setErrorStatus(validationError)
      return
    }
    if (!hasDesktopBridge) return
    setSaving(true)
    setErrorStatus('')

    const payload = {
      name: form.name.trim(),
      profileId: form.profileId,
      pageIdentity: form.pageIdentity || 'personal',
      groupIds: form.groupIds,
      delayMinutes: Number(form.delayMinutes) || 1,
    }

    try {
      if (editingQueue) {
        await window.desktopApp.updateSyncQueue(editingQueue.id, payload)
      } else {
        await window.desktopApp.addSyncQueue(payload)
      }
      await loadData(true)
      dismissModal()
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_saving')}${extractErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (queue) => {
    if (!confirm(t('sync_queue.modal.alerts.confirm_delete', { name: queue.name }))) return
    if (!hasDesktopBridge) return
    setSaving(true)
    setErrorStatus('')
    try {
      await window.desktopApp.deleteSyncQueue(queue.id)
      await loadData(true)
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_deleting')}${extractErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleStartQueue = async (queue) => {
    if (!hasDesktopBridge) return
    setErrorStatus('')
    try {
      // Validate profile still exists
      const profile = profiles.find(p => p.id === queue.profileId);
      if (!profile) {
        setErrorStatus(t('post_queue.modal.alerts.missing_profile_start'));
        return;
      }

      await window.desktopApp.startSyncQueue(queue.id)
    } catch (error) {
      setErrorStatus(extractErrorMessage(error))
    }
  }

  const handleStopQueue = async (queue) => {
    if (!hasDesktopBridge) return
    setErrorStatus('')
    try {
      await window.desktopApp.stopSyncQueue(queue.id)
    } catch (error) {
      setErrorStatus(`${t('sync_queue.modal.alerts.error_stopping')}${extractErrorMessage(error)}`)
    }
  }

  const handleResetQueue = async (queue) => {
    if (!confirm(t('sync_queue.modal.alerts.confirm_reset', { name: queue.name }))) return
    if (!hasDesktopBridge) return
    setErrorStatus('')
    try {
      await window.desktopApp.resetSyncQueue(queue.id)
      await loadData(true)
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_resetting')}${extractErrorMessage(error)}`)
    }
  }

  const resolveIdentityLabel = (queue) => {
    if (!queue.pageIdentity || queue.pageIdentity === 'personal') {
      return t('post_queue.labels.personal_account')
    }
    const profile = profiles.find((item) => item.id === queue.profileId)
    const page = profile?.pages?.find((item) => item.pageUrl === queue.pageIdentity)
    return page?.pageName || queue.pageIdentity
  }

  const currentLogQueue = useMemo(() => {
    if (!showLogsId) return null
    return queues.find(q => q.id === showLogsId)
  }, [showLogsId, queues])

  return (
    <div className="relative h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 gap-4 text-sm md:text-base">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('sync_queue.title')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tighter text-[11px] font-bold">
            {t('sync_queue.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">

          <button
            onClick={openAddModal}
            disabled={saving || !readyProfiles || !readyGroups}
            className="btn-primary flex items-center gap-2 shadow-lg shadow-blue-100 dark:shadow-none"
          >
            <Plus className="w-5 h-5" />
            {t('sync_queue.buttons.create_task')}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {errorStatus && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm rounded-lg flex justify-between items-center animate-in fade-in duration-200">
          <span><strong>{t('post_queue.alerts.error_prefix')}</strong> {errorStatus}</span>
          <button onClick={() => setErrorStatus('')} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 font-bold">×</button>
        </div>
      )}

      {/* Queue list */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex-1 overflow-auto p-5 transition-colors">
        {loading ? (
          <div className="py-20 text-center text-slate-400 dark:text-slate-500">{t('sync_queue.loading')}</div>
        ) : queues.length === 0 ? (
          <div className="py-20 px-8 text-center text-slate-400 dark:text-slate-500 bg-slate-50/50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
            {t('sync_queue.empty_state')}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-10">
            {queues.map((queue) => {
              const isRunning = runningIds.includes(queue.id)
              const groupCount = queue.groupIds?.length || 0
              const state = queue.state || { currentGroupIndex: 0, status: 'idle' }
              const lastLog = queue.logs && queue.logs.length > 0 ? queue.logs[queue.logs.length - 1] : null
              const isPendingApproval = isRunning && state.status === 'pending_approval'

              return (
                <article
                  key={queue.id}
                  className={`rounded-2xl border transition-all duration-300 flex flex-col group/card h-full ${
                    isRunning ? 'border-indigo-300 ring-4 ring-indigo-50 dark:ring-indigo-900/20 bg-white dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/50'
                  }`}
                >                  <div className="p-5 flex-1 pb-3">
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate" title={queue.name}>{queue.name}</h3>
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isRunning 
                              ? (isPendingApproval ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 ring-4 ring-orange-50 dark:ring-orange-900/20' : (state.status === 'running' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400'))
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                          }`}>
                            {isRunning ? (
                              <>
                                <span className={`w-1.5 h-1.5 rounded-full bg-current ${state.status === 'running' ? 'animate-ping' : ''}`} />
                                {isPendingApproval ? t('post_queue.badges.pending_approval') : (state.status === 'running' ? t('sync_queue.badges.syncing') : t('post_queue.badges.waiting'))}
                              </>
                            ) : (
                              t('post_queue.badges.paused')
                            )}
                          </span>
                          {queue.approvalMode && !isPendingApproval && (
                             <ShieldCheck className="w-4 h-4 text-indigo-400 dark:text-indigo-500" title={t('post_queue.tooltips.manual_approval')} />
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-tight">
                          {t('sync_queue.labels.posting_identity')} <span className="text-slate-700 dark:text-slate-300">{resolveIdentityLabel(queue)}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleResetQueue(queue)}
                          disabled={saving || isRunning}
                          className="p-2 text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/40 rounded-lg transition-colors disabled:opacity-30"
                          title={t('post_queue.tooltips.reset_process')}
                        >
                          <RotateCcw className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => setShowLogsId(queue.id)}
                          className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 rounded-lg transition-colors"
                          title={t('post_queue.tooltips.event_history')}
                        >
                          <History className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => openEditModal(queue)}
                          disabled={saving || isRunning}
                          className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 rounded-lg transition-colors disabled:opacity-30"
                          title={t('post_queue.tooltips.edit')}
                        >
                          <Pencil className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDelete(queue)}
                          disabled={saving}
                          className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                          title={t('post_queue.tooltips.delete')}
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    {/* Progress Info */}
                    <div className={`mt-4 rounded-2xl border p-3.5 transition-colors ${
                      isRunning ? 'bg-indigo-50/30 dark:bg-indigo-900/10 border-indigo-100/50 dark:border-indigo-800/50' : 'bg-white/80 dark:bg-slate-800/80 border-slate-200/60 dark:border-slate-700'
                    }`}>
                      <div className="flex items-center justify-between text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                        <span>{t('sync_queue.progress.source_progress')}</span>
                        <span className="text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-full border border-slate-100 dark:border-slate-700">{t('sync_queue.progress.source_count', {current: Math.min(state.currentGroupIndex + 1, groupCount), total: groupCount})}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden shadow-inner p-0.5">
                          <div 
                            className="h-full bg-linear-to-r from-indigo-400 to-indigo-600 dark:from-indigo-500 dark:to-indigo-700 rounded-full transition-all duration-1000 shadow-sm"
                            style={{ width: `${Math.min(((state.currentGroupIndex) / groupCount) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-black text-slate-700 dark:text-slate-200 shrink-0 min-w-[60px] text-right">
                          {Math.min(state.currentGroupIndex, groupCount)} / {groupCount} <span className="text-slate-300 dark:text-slate-500 font-normal">{t('sync_queue.progress.targets')}</span>
                        </span>
                      </div>
                      <p className="mt-3 text-[11px] font-medium text-slate-500 flex items-center gap-2">
                        <Zap className="w-3 h-3 text-yellow-500 dark:text-yellow-600 fill-current" />
                        <span>{t('sync_queue.progress.current_target')}</span> 
                        <span className="text-slate-700 dark:text-slate-300 font-bold truncate">
                          {queue.groupIds[state.currentGroupIndex % groupCount] ? (groups.find(g => g.id === queue.groupIds[state.currentGroupIndex % groupCount])?.name) : t('post_queue.progress.completed')}
                        </span>
                      </p>
                    </div>

                    {/* Latest Log */}
                    {lastLog && (
                      <div className={`mt-4 rounded-xl border p-3 flex gap-3 items-start animate-in slide-in-from-bottom-2 duration-300 shadow-sm ${
                        lastLog.type === 'success' ? 'bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/50' : 
                        lastLog.type === 'error' ? 'bg-red-50/50 dark:bg-red-900/20 border-red-100 dark:border-red-800/50' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}>
                         <div className="mt-0.5 shrink-0">
                           {lastLog.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> :
                            lastLog.type === 'error' ? <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" /> :
                            <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
                         </div>
                         <div className="min-w-0 flex-1">
                            <p className={`text-[13px] font-bold leading-tight ${
                              lastLog.type === 'success' ? 'text-emerald-800 dark:text-emerald-300' :
                              lastLog.type === 'error' ? 'text-red-800 dark:text-red-300' : 'text-slate-800 dark:text-slate-300'
                            }`}>
                              {lastLog.message && lastLog.message.includes('.') ? t(lastLog.message) : lastLog.message}
                            </p>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 block mt-1 uppercase tracking-tighter font-bold">
                              {t('post_queue.logs.updated_at', {time: new Date(lastLog.timestamp).toLocaleTimeString()})}
                            </span>
                         </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="p-4 pt-0 mt-auto flex gap-2 items-stretch">

                    
                    {!isRunning ? (
                      <button
                        onClick={() => handleStartQueue(queue)}
                        disabled={saving}
                        className="flex-1 btn-primary py-2.5 rounded-xl flex items-center justify-center gap-2 group shadow-sm bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition-all uppercase text-xs font-black tracking-widest"
                      >
                        <Play className="w-4 h-4 fill-current transition-transform group-hover:scale-110" />
                        {t('sync_queue.buttons.start_sync')}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStopQueue(queue)}
                        disabled={saving}
                        className={`${isPendingApproval ? 'w-12 px-0' : 'flex-1 py-2.5'} btn-secondary flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-white border-slate-800 hover:bg-slate-900 dark:bg-slate-950 dark:hover:bg-slate-900 dark:border-slate-800 shadow-sm transition-all uppercase text-xs font-black tracking-widest`}
                        title="Stop Sync"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        {!isPendingApproval && t('sync_queue.buttons.stop')}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {/* Logs Modal/Panel */}
      {showLogsId && currentLogQueue && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-[80vh] animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <History className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />
                  {t('post_queue.logs.title', {name: currentLogQueue.name})}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">{t('post_queue.logs.subtitle')}</p>
              </div>
              <button 
                onClick={() => setShowLogsId(null)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-slate-400 dark:text-slate-300" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30 dark:bg-slate-900">
              {(!currentLogQueue.logs || currentLogQueue.logs.length === 0) ? (
                <div className="text-center py-20 text-slate-400 dark:text-slate-500 font-medium">{t('post_queue.logs.empty_state')}</div>
              ) : (
                [...currentLogQueue.logs].reverse().map((log, idx) => {
                  const urlMatch = log.message.match(/https?:\/\/[^\s]+/);
                  const msgText = urlMatch ? log.message.replace(urlMatch[0], '').trim() : log.message;

                  return (
                    <div key={idx} className={`p-4 rounded-2xl border transition-all ${
                      log.type === 'success' ? 'bg-white dark:bg-slate-800 border-emerald-100 dark:border-emerald-800/50 text-emerald-900 dark:text-emerald-300 shadow-sm' :
                      log.type === 'error' ? 'bg-white dark:bg-slate-800 border-red-100 dark:border-red-800/50 text-red-900 dark:text-red-300 shadow-sm' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-300 shadow-sm'
                    }`}>
                      <div className="flex justify-between items-start gap-4 mb-2">
                         <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                           log.type === 'success' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' :
                           log.type === 'error' ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400'
                         }`}>
                           {log.type}
                         </span>
                         <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 font-bold">{formatDate(log.timestamp)}</span>
                      </div>
                      <p className="text-sm font-bold leading-relaxed">
                        {msgText && msgText.includes('.') ? t(msgText) : msgText}
                      </p>
                      {urlMatch && (
                        <a 
                          href={urlMatch[0]} 
                          target="_blank" 
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/40 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-800/50"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {t('sync_queue.logs.open_related_link')}
                        </a>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Modal (Add/Edit) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-7xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 max-h-[95vh]">
            {/* Modal header */}
            <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                  {editingQueue ? t('sync_queue.modal.edit_title') : t('sync_queue.modal.add_title')}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  {t('sync_queue.modal.subtitle')}
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1.5 rounded-lg"><X className="w-6 h-6" /></button>
            </div>

            {/* Error inside modal */}
            {errorStatus && (
              <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm rounded-lg flex justify-between items-center animate-in fade-in duration-200">
                <span><strong>{t('post_queue.alerts.error_prefix')}</strong> {errorStatus}</span>
                <button onClick={() => setErrorStatus('')} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 font-bold ml-3 shrink-0">×</button>
              </div>
            )}

            {/* Modal body */}
            <div className="p-6 overflow-y-auto bg-slate-50/30 dark:bg-slate-900/50">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left side: Basic Info & Sources */}
                <div className="space-y-6">
                  <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 dark:text-slate-500 mb-1.5 uppercase tracking-widest">{t('sync_queue.modal.labels.task_name')}</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => updateForm('name', e.target.value)}
                        placeholder={t('sync_queue.modal.placeholders.task_name')}
                        className="input-field py-3 text-lg font-bold"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 dark:text-slate-500 mb-1.5 uppercase tracking-widest">{t('post_queue.modal.labels.profile')}</label>
                        <select
                          value={form.profileId}
                          onChange={(e) => handleProfileChange(e.target.value)}
                          className="input-field font-bold"
                        >
                          <option value="">{t('post_queue.modal.options.select_profile')}</option>
                          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 dark:text-slate-500 mb-1.5 uppercase tracking-widest">{t('post_queue.modal.labels.posting_identity')}</label>
                        <select
                          value={form.pageIdentity}
                          onChange={(e) => updateForm('pageIdentity', e.target.value)}
                          className="input-field font-bold"
                        >
                          <option value="personal">{t('post_queue.modal.options.personal_account')}</option>
                          {availablePages.map(p => <option key={p.id} value={p.pageUrl}>{p.pageName}</option>)}
                        </select>
                      </div>
                    </div>  
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 dark:text-slate-500 mb-1.5 uppercase tracking-widest">{t('sync_queue.modal.labels.delay_groups')}</label>
                      <input
                        type="number"
                        min="1"
                        value={form.delayMinutes || ''}
                        onChange={(e) => updateForm('delayMinutes', e.target.value)}
                        placeholder={t('sync_queue.modal.placeholders.delay_groups')}
                        className="input-field font-bold"
                      />
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 font-bold tracking-tight">{t('sync_queue.modal.descriptions.delay_groups')}</p>
                    </div>
                    <div className="pt-2">
                       <label className="flex items-center gap-3 cursor-pointer group">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only" 
                              checked={form.approvalMode}
                              onChange={(e) => updateForm('approvalMode', e.target.checked)}
                            />
                            <div className={`block w-12 h-7 rounded-full transition-colors ${form.approvalMode ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                            <div className={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${form.approvalMode ? 'translate-x-5' : ''}`} />
                          </div>
                          <div>
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 block">{t('post_queue.modal.labels.manual_approval')}</span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('sync_queue.modal.descriptions.manual_approval')}</span>
                          </div>
                       </label>
                    </div>
                  </div>
                </div>

                {/* Right side: Target Group Selection */}
                <div className="space-y-4 flex flex-col h-[500px]">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('sync_queue.modal.labels.target_destinations', {count: form.groupIds.length})}</h4>
                    <div className="flex gap-4">
                      <button onClick={() => updateForm('groupIds', groups.map(g => g.id))} className="text-[11px] text-indigo-600 dark:text-indigo-400 font-black hover:underline uppercase">{t('sync_queue.modal.buttons.select_all')}</button>
                      <button onClick={() => updateForm('groupIds', [])} className="text-[11px] text-slate-400 dark:text-slate-500 font-black hover:underline uppercase">{t('sync_queue.modal.buttons.deselect_all')}</button>
                    </div>
                  </div>
                  <div className="flex-1 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
                    <div className="overflow-y-auto flex-1 divide-y divide-slate-50 dark:divide-slate-700/50 custom-scrollbar">
                      {groups.length === 0 ? <p className="p-10 text-center text-slate-400 dark:text-slate-500 italic">{t('sync_queue.modal.empty_targets')}</p> : groups.map(g => {
                        const checked = form.groupIds.includes(g.id);
                        return (
                          <label key={g.id} className={`flex items-start gap-4 p-5 cursor-pointer transition-all ${checked ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                            <div className="relative mt-0.5">
                              <input 
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleGroupSelection(g.id)}
                                className="h-5 w-5 rounded-lg border-2 border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 dark:bg-slate-800"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                               <p className={`text-sm font-black ${checked ? 'text-indigo-900 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>{g.name}</p>
                               <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate w-full font-medium">{g.url}</p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="p-6 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 flex justify-end gap-3 rounded-b-2xl">
              <button 
                onClick={closeModal}
                disabled={saving}
                className="btn-secondary text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 px-8 py-3 uppercase text-xs font-black tracking-widest transition-colors"
              >
                {t('post_queue.modal.buttons.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !readyProfiles}
                className="btn-primary flex items-center gap-2 group shadow-xl shadow-blue-100 dark:shadow-none bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 border-indigo-600 px-10 py-3 uppercase text-xs font-black tracking-widest transition-transform active:scale-95"
              >
                <Save className="w-4 h-4" />
                {saving ? t('post_queue.modal.buttons.saving') : editingQueue ? t('post_queue.modal.buttons.update_config') : t('post_queue.modal.buttons.save_config')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
