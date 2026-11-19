import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ExternalLink,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  X,
  History,
  Clock,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Zap,
  RotateCcw,
  RefreshCw,
  DownloadCloud,
  LayoutGrid,
  LayoutList,
  Search,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Eraser,
  Loader2,
  Calendar,
} from 'lucide-react'
import TrelloImportModal from '../components/TrelloImportModal'

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function parseScheduledTime(val) {
  if (!val) {
    const now = new Date()
    now.setHours(now.getHours() + 1, 0, 0, 0)
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const h = String(now.getHours()).padStart(2, '0')
    const min = String(now.getMinutes()).padStart(2, '0')
    return {
      date: `${y}-${m}-${d}`,
      hour: h,
      minute: min,
      iso: `${y}-${m}-${d}T${h}:${min}`,
    }
  }
  const parts = String(val).split('T')
  const date = parts[0] || new Date().toISOString().slice(0, 10)
  const timePart = parts[1] ? parts[1].slice(0, 5) : '12:00'
  const [h = '12', min = '00'] = timePart.split(':')
  const safeH = String(Math.min(23, Math.max(0, parseInt(h, 10) || 0))).padStart(2, '0')
  const safeM = String(Math.min(59, Math.max(0, parseInt(min, 10) || 0))).padStart(2, '0')
  return {
    date,
    hour: safeH,
    minute: safeM,
    iso: `${date}T${safeH}:${safeM}`,
  }
}

function formatDateDMY(dateStr) {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

const EMPTY_POST = {
  selected: true,
  content: '',
  commentText: '',
  imagePath: '',
  imageBase64: '',
  imageUrl: '',
  thumbnailUrl: '',
  trelloCardId: '',
  trelloCardName: '',
  enableSchedule: false,
  scheduleType: 'exact',
  scheduledTime: '',
  delayHours: 0,
  delayMinutes: 30,
}

const EMPTY_FORM = {
  name: '',
  profileId: '',
  pageIdentity: 'personal',
  trelloBoardId: '',
  trelloListId: '',
  trelloListName: '',
  posts: [{ ...EMPTY_POST }],
  approvalMode: false,
}

function PostThumbnailPreview({ post }) {
  const [fetchedThumbBase64, setFetchedThumbBase64] = useState(null);

  useEffect(() => {
    if (post.imageBase64 || !post.thumbnailUrl || !window.desktopApp?.getTrelloThumbnailBase64) {
      return;
    }
    let isMounted = true;
    window.desktopApp.getTrelloThumbnailBase64(post.thumbnailUrl).then((b64) => {
      if (isMounted && b64) setFetchedThumbBase64(b64);
    }).catch(() => {});
    return () => { isMounted = false; };
  }, [post.imageBase64, post.thumbnailUrl]);

  const thumbBase64 = post.imageBase64 || fetchedThumbBase64;

  if (thumbBase64) {
    return (
      <div className="relative w-full h-full">
        <img src={thumbBase64} alt="Preview" className="w-full h-full object-cover" />
        {post.trelloCardId && !post.imagePath && (
          <span className="absolute bottom-1 left-1 right-1 bg-blue-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded text-center truncate backdrop-blur-xs">
            Trello (Tự tải khi đăng)
          </span>
        )}
      </div>
    );
  }

  if (post.imagePath) {
    return (
      <div className="relative w-full h-full">
        <img src={`file:///${post.imagePath.replace(/\\/g, '/')}`} alt="Preview" className="w-full h-full object-cover" />
      </div>
    );
  }

  if (post.trelloCardId || post.imageUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-blue-50/50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 p-2 text-center select-none">
        <Zap className="w-6 h-6 mb-1 text-blue-500 fill-current opacity-70" />
        <span className="text-[10px] font-bold">Thẻ Trello</span>
        <span className="text-[9px] text-slate-400 mt-0.5">(Tự tải ảnh khi đăng)</span>
      </div>
    );
  }

  return null;
}

const ACCENT_COLORS = [
  'border-l-blue-500',
  'border-l-emerald-500',
  'border-l-purple-500',
  'border-l-amber-500',
  'border-l-pink-500',
  'border-l-teal-500',
  'border-l-indigo-500'
];

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


function extractErrorMessage(error) {
  if (!error || !error.message) return 'Unknown error';
  return error.message.replace(/Error invoking remote method '[^']+':\s*Error:\s*/, '').replace(/Error:\s*/, '');
}

export default function PostQueuePage() {
  const { t } = useTranslation()
  const [queues, setQueues] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningIds, setRunningIds] = useState([])
  const [startingIds, setStartingIds] = useState(new Set())
  const [stoppingIds, setStoppingIds] = useState(new Set())
  const [openingProfileIds, setOpeningProfileIds] = useState(new Set())
  const [runningProfileIds, setRunningProfileIds] = useState(new Set())
  const [approvingIds, setApprovingIds] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingQueue, setEditingQueue] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errorStatus, setErrorStatus] = useState('')
  const [ctaList, setCtaList] = useState([])
  const [showLogsId, setShowLogsId] = useState(null)
  const [isTrelloModalOpen, setIsTrelloModalOpen] = useState(false)
  const [isSpreadOpen, setIsSpreadOpen] = useState(false)
  const [spreadMinutes, setSpreadMinutes] = useState(30)
  const [syncingAllTrello, setSyncingAllTrello] = useState(false)
  const [syncProgress, setSyncProgress] = useState(null)
  const [viewLayout, setViewLayout] = useState(() => localStorage.getItem('postQueueLayout') || 'grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [queueOrder, setQueueOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('queueOrder') || '[]') } catch { return [] }
  })
  const [draggedId, setDraggedId] = useState(null)

  const toggleLayout = () => {
    const newLayout = viewLayout === 'grid' ? 'list' : 'grid'
    setViewLayout(newLayout)
    localStorage.setItem('postQueueLayout', newLayout)
  }

  const hasDesktopBridge = Boolean(window.desktopApp)

  // --- Data loading ---

  const loadData = useCallback(async (isSilent = false) => {
    if (!hasDesktopBridge) {
      if (!isSilent) setLoading(false)
      return
    }

    if (!isSilent) setLoading(true)
    try {
      const [queueData, profileData, runningData, ctaData] = await Promise.all([
        window.desktopApp.getQueues(),
        window.desktopApp.getProfiles(),
        window.desktopApp.getRunningQueueIds(),
        window.desktopApp.getCTAConfig ? window.desktopApp.getCTAConfig() : Promise.resolve([]),
      ])

      setQueues(queueData || [])
      setProfiles(profileData || [])
      setRunningIds(runningData || [])
      setCtaList(ctaData || [])
    } catch (error) {
      console.error('Data load error:', error)
      if (!isSilent) setErrorStatus(`Data load error: ${error.message}`)
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [hasDesktopBridge])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Listen for running IDs changes
  useEffect(() => {
    if (!hasDesktopBridge) return undefined

    return window.desktopApp.onQueueRunningUpdate((ids) => {
      setRunningIds(ids || [])
      loadData(true)
    })
  }, [hasDesktopBridge, loadData])

  // Real-time queue data updates from backend
  useEffect(() => {
    if (!hasDesktopBridge) return undefined

    return window.desktopApp.onQueueDataUpdate(({ id, queue: updatedQueue }) => {
      setQueues((prev) =>
        prev.map((q) => (q.id === id ? updatedQueue : q)),
      )
    })
  }, [hasDesktopBridge])

  // Real-time running profiles updates
  useEffect(() => {
    if (window.desktopApp?.getRunningProfileIds) {
      window.desktopApp.getRunningProfileIds().then((ids) => {
        setRunningProfileIds(new Set((ids || []).map(String)))
      }).catch(() => {})
    }
    if (window.desktopApp?.onProfileRunningUpdate) {
      const unsub = window.desktopApp.onProfileRunningUpdate((ids) => {
        setRunningProfileIds(new Set((ids || []).map(String)))
      })
      return () => unsub()
    }
  }, [])

  // --- Derived state ---

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === form.profileId) || null,
    [form.profileId, profiles],
  )

  const btvOrderedProfiles = useMemo(() => {
    let order = []
    try {
      order = JSON.parse(localStorage.getItem('profileOrder') || '[]')
    } catch {
      order = []
    }

    const sorted = [...profiles].sort((a, b) => {
      const idxA = order.indexOf(a.id)
      const idxB = order.indexOf(b.id)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return 0
    })

    const btvList = sorted.filter(p => (p.metadata?.category || '').trim().toLowerCase() === 'btv')

    // Nếu không có profile nào được đánh dấu BTV, fallback sang danh sách đã sắp xếp
    if (btvList.length === 0) {
      return sorted
    }

    // Nếu profile hiện tại trong form không phải BTV, vẫn giữ lại để không mất dữ liệu của hàng đợi
    if (form.profileId && !btvList.some(p => p.id === form.profileId)) {
      const currentSelected = profiles.find(p => p.id === form.profileId)
      if (currentSelected) {
        return [currentSelected, ...btvList]
      }
    }

    return btvList
  }, [profiles, form.profileId])

  const availablePages = selectedProfile?.pages || []
  const readyProfiles = profiles.length > 0

  const sortedQueues = useMemo(() => {
    const sorted = [...queues]
    sorted.sort((a, b) => {
      const idxA = queueOrder.indexOf(a.id)
      const idxB = queueOrder.indexOf(b.id)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return 0
    })
    return sorted
  }, [queues, queueOrder])

  const filteredQueues = useMemo(() => {
    if (!searchQuery.trim()) return sortedQueues
    const query = searchQuery.toLowerCase()
    return sortedQueues.filter(q => q.name?.toLowerCase().includes(query))
  }, [sortedQueues, searchQuery])

  const handleDragStart = (e, id) => {
    if (searchQuery) {
      e.preventDefault()
      return
    }
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
    if (!draggedId || draggedId === targetId || searchQuery) return

    const currentIndex = sortedQueues.findIndex(q => q.id === draggedId)
    const targetIndex = sortedQueues.findIndex(q => q.id === targetId)
    
    if (currentIndex === -1 || targetIndex === -1) return

    const newOrder = [...sortedQueues]
    const [draggedItem] = newOrder.splice(currentIndex, 1)
    newOrder.splice(targetIndex, 0, draggedItem)

    const newOrderIds = newOrder.map(q => q.id)
    setQueueOrder(newOrderIds)
    localStorage.setItem('queueOrder', JSON.stringify(newOrderIds))
    setDraggedId(null)
  }


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
    const targetProfile = profiles.find((item) => item.id === queue.profileId)
    const defaultPageIdentity =
      (!queue.pageIdentity || queue.pageIdentity === 'personal') && targetProfile?.pages?.length > 0
        ? targetProfile.pages[0].pageUrl
        : (queue.pageIdentity || 'personal')

    setForm({
      name: queue.name || '',
      profileId: queue.profileId || '',
      pageIdentity: defaultPageIdentity,
      trelloBoardId: queue.trelloBoardId || '',
      trelloListId: queue.trelloListId || '',
      trelloListName: queue.trelloListName || '',
      posts: Array.isArray(queue.posts) && queue.posts.length > 0
        ? queue.posts.map((post) => ({ 
            selected: post.selected !== undefined ? Boolean(post.selected) : true,
            content: post.content || '', 
            commentText: post.commentText || '',
            imagePath: post.imagePath || '',
            imageBase64: post.imageBase64 || '',
            imageUrl: post.imageUrl || '',
            thumbnailUrl: post.thumbnailUrl || '',
            trelloCardId: post.trelloCardId || '',
            trelloCardName: post.trelloCardName || '',
            enableSchedule: !!post.enableSchedule,
            scheduleType: post.scheduleType || 'exact',
            scheduledTime: post.scheduledTime || '',
            delayHours: post.delayHours !== undefined ? Number(post.delayHours) : 0,
            delayMinutes: post.delayMinutes !== undefined ? Number(post.delayMinutes) : 30,
          }))
        : [{ ...EMPTY_POST }],
      approvalMode: queue.approvalMode || false,
    })

    // Tự động nạp cấu hình Trello đã chọn nếu có
    if (window.desktopApp?.getTrelloSelections) {
      window.desktopApp.getTrelloSelections(queue.id).then(sel => {
        if (sel?.listId) {
          setForm(prev => ({
            ...prev,
            trelloBoardId: prev.trelloBoardId || sel.boardId || '',
            trelloListId: prev.trelloListId || sel.listId || '',
          }))
        }
      }).catch(() => {})
    }

    setErrorStatus('')
    setIsModalOpen(true)
  }

  const dismissModal = () => {
    setIsModalOpen(false)
    setIsSpreadOpen(false)
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
        : (profile?.pages?.length > 0 ? profile.pages[0].pageUrl : 'personal')

    setForm((prev) => ({
      ...prev,
      profileId,
      pageIdentity: nextPageIdentity,
    }))
  }

  const addPost = () => {
    setForm((prev) => ({
      ...prev,
      posts: [{ ...EMPTY_POST }, ...prev.posts],
    }))
  }

  const removePost = (index) => {
    setForm((prev) => ({
      ...prev,
      posts: prev.posts.filter((_, i) => i !== index),
    }))
  }

  const movePost = (index, direction) => {
    setForm((prev) => {
      const newPosts = [...prev.posts];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= newPosts.length) return prev;
      
      const temp = newPosts[index];
      newPosts[index] = newPosts[targetIndex];
      newPosts[targetIndex] = temp;
      
      return { ...prev, posts: newPosts };
    });
  }

  const updatePost = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      posts: prev.posts.map((post, i) => (i === index ? { ...post, [field]: value } : post)),
    }))
  }

  const handleBrowsePostImage = async (index) => {
    if (!hasDesktopBridge) return

    const result = await window.desktopApp.selectImage()
    if (result) {
      updatePost(index, 'imagePath', result.filePath)
      updatePost(index, 'imageBase64', result.base64)
    }
  }

  const applyAutoSpreadSchedule = (minutesInput) => {
    if (!form.posts || form.posts.length === 0) return
    const intervalMin = parseInt(minutesInput !== undefined ? minutesInput : spreadMinutes, 10)
    if (isNaN(intervalMin) || intervalMin <= 0) return

    setSpreadMinutes(intervalMin)
    setForm((prev) => {
      const hasAnySelected = prev.posts.some((p) => p.selected !== false)
      let selectedOrder = 0
      const h = Math.floor(intervalMin / 60)
      const m = intervalMin % 60
      const updated = prev.posts.map((post) => {
        if (hasAnySelected && post.selected === false) {
          return { ...post, enableSchedule: false }
        }
        const orderIdx = selectedOrder++
        if (orderIdx === 0) {
          return {
            ...post,
            enableSchedule: false,
          }
        }
        return {
          ...post,
          enableSchedule: true,
          scheduleType: 'delay',
          delayHours: h,
          delayMinutes: m,
        }
      })
      return { ...prev, posts: updated }
    })
    setIsSpreadOpen(false)
  }

  const handleAutoSpreadSchedule = () => {
    if (!form.posts || form.posts.length === 0) return
    setIsSpreadOpen((prev) => !prev)
  }

  const validateForm = () => {
    if (!form.name.trim()) return t('post_queue.modal.alerts.missing_name')
    if (!form.profileId) return t('post_queue.modal.alerts.missing_profile')
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
      trelloBoardId: form.trelloBoardId || '',
      trelloListId: form.trelloListId || '',
      trelloListName: form.trelloListName || '',
      posts: (form.posts || []).filter((post) => post && post.content && post.content.trim()).map((post) => ({
        selected: post.selected !== undefined ? Boolean(post.selected) : true,
        content: post.content.trim(),
        commentText: (post.commentText || '').trim(),
        imagePath: post.imagePath || '',
        imageBase64: post.imageBase64 || '',
        imageUrl: post.imageUrl || '',
        thumbnailUrl: post.thumbnailUrl || '',
        trelloCardId: post.trelloCardId || '',
        trelloCardName: post.trelloCardName || '',
        enableSchedule: Boolean(post.enableSchedule),
        scheduleType: post.scheduleType === 'delay' ? 'delay' : 'exact',
        scheduledTime: post.scheduledTime || '',
        delayHours: Math.max(0, parseInt(post.delayHours, 10) || 0),
        delayMinutes: Math.max(0, parseInt(post.delayMinutes, 10) || 0),
      })),
      approvalMode: form.approvalMode,
    }

    try {
      let savedQueue = null;
      if (editingQueue) {
        savedQueue = await window.desktopApp.updateQueue(editingQueue.id, payload)
      } else {
        savedQueue = await window.desktopApp.addQueue(payload)
      }

      if (form.trelloListId && window.desktopApp?.saveTrelloSelections) {
        const targetQId = (savedQueue && savedQueue.id) || (editingQueue && editingQueue.id) || 'new';
        await window.desktopApp.saveTrelloSelections({
          queueId: targetQId,
          boardId: form.trelloBoardId || '',
          listId: form.trelloListId || ''
        }).catch(() => {});
      }

      await loadData()
      dismissModal()
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_saving')}${extractErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (queue) => {
    if (!confirm(t('post_queue.modal.alerts.confirm_delete', { name: queue.name }))) return
    if (!hasDesktopBridge) return
    setSaving(true)
    setErrorStatus('')
    try {
      await window.desktopApp.deleteQueue(queue.id)
      await loadData()
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_deleting')}${extractErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleClearPosts = async (queue) => {
    if (!confirm('Bạn có chắc chắn muốn xóa tất cả danh sách bài đăng trong hàng đợi này không? Hàng đợi sẽ được giữ lại nhưng không còn bài viết nào.')) return
    if (!hasDesktopBridge) return
    setSaving(true)
    setErrorStatus('')
    try {
      await window.desktopApp.updateQueue(queue.id, { ...queue, posts: [], state: { currentPostIndex: 0, status: 'idle' } })
      await loadData()
    } catch (error) {
      setErrorStatus(`Lỗi xóa bài đăng: ${extractErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenProfile = async (profileId) => {
    if (!profileId) {
      setErrorStatus('Hàng đợi này chưa được gắn Profile!')
      return
    }
    const profile = profiles.find((p) => p.id === profileId)
    if (!profile) {
      setErrorStatus('Profile liên kết với hàng đợi này không tồn tại!')
      return
    }
    if (!hasDesktopBridge || !window.desktopApp?.openProfile) return

    setOpeningProfileIds((prev) => new Set(prev).add(profileId))
    try {
      await window.desktopApp.openProfile(profileId)
    } catch (err) {
      setErrorStatus('Lỗi mở Profile: ' + (err.message || err))
    } finally {
      setOpeningProfileIds((prev) => {
        const next = new Set(prev)
        next.delete(profileId)
        return next
      })
    }
  }

  const handleQuickSyncQueue = async (queue) => {
    if (!hasDesktopBridge) return
    setErrorStatus('')
    setSaving(true)
    try {
      let listId = queue.trelloListId
      if (!listId) {
        const sel = await window.desktopApp.getTrelloSelections(queue.id)
        listId = sel?.listId
      }
      if (!listId) {
        openEditModal(queue)
        setIsTrelloModalOpen(true)
        return
      }

      const rawPosts = await window.desktopApp.syncTrelloCards({ listId, autoWrapLink: true })
      if (!rawPosts || rawPosts.length === 0) {
        alert(`Không tìm thấy thẻ bài viết nào trong danh sách Trello đã liên kết của "${queue.name}".`)
        return
      }
      const posts = rawPosts.map((p) => ({ ...p, selected: false }))

      await window.desktopApp.updateQueue(queue.id, {
        ...queue,
        posts,
        trelloListId: listId,
        state: { currentPostIndex: 0, status: 'idle' }
      })
      await loadData(true)
      alert(`Đã liên kết và nạp trực tiếp ${posts.length} bài viết từ Trello vào hàng đợi "${queue.name}" thành công!\n(Chưa chọn sẵn bài viết nào — hãy bấm Chỉnh sửa hàng đợi để tích chọn bài muốn đăng)`)
    } catch (err) {
      console.error('Trello quick sync error:', err)
      setErrorStatus(`Lỗi đồng bộ Trello cho "${queue.name}": ${extractErrorMessage(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSyncAllTrello = async () => {
    if (!hasDesktopBridge || queues.length === 0) return
    if (syncingAllTrello || saving) return

    if (!confirm('Bạn có muốn cập nhật lại thẻ Trello cho tất cả các hàng đợi/profile không?\n(Chỉ những hàng đợi đã liên kết danh sách Trello sẽ được cập nhật)')) {
      return
    }

    setSyncingAllTrello(true)
    setErrorStatus('')
    let successCount = 0
    let skippedCount = 0
    let totalCardsSynced = 0
    const errors = []

    try {
      for (let i = 0; i < queues.length; i++) {
        const q = queues[i]
        setSyncProgress({ current: i + 1, total: queues.length, queueName: q.name })

        // Bỏ qua nếu hàng đợi đang chạy để tránh xung đột dữ liệu
        if (runningIds.includes(q.id)) {
          console.warn(`Bỏ qua hàng đợi "${q.name}" vì đang chạy.`)
          skippedCount++
          continue
        }

        let listId = q.trelloListId
        if (!listId) {
          const sel = await window.desktopApp.getTrelloSelections(q.id)
          listId = sel?.listId
        }

        if (!listId) {
          skippedCount++
          continue
        }

        try {
          const rawPosts = await window.desktopApp.syncTrelloCards({ listId, autoWrapLink: true })
          const posts = Array.isArray(rawPosts) ? rawPosts.map((p) => ({ ...p, selected: false })) : []

          await window.desktopApp.updateQueue(q.id, {
            ...q,
            posts,
            trelloListId: listId,
            state: { currentPostIndex: 0, status: 'idle' }
          })
          successCount++
          totalCardsSynced += posts.length
        } catch (err) {
          console.error(`Lỗi đồng bộ Trello cho "${q.name}":`, err)
          errors.push(`${q.name}: ${err.message || err}`)
        }
      }

      await loadData(true)

      let resultMsg = `Hoàn tất cập nhật Trello cho toàn bộ hàng đợi/profile:\n- Thành công: ${successCount} hàng đợi (${totalCardsSynced} bài viết nạp mới)\n`
      if (skippedCount > 0) {
        resultMsg += `- Bỏ qua: ${skippedCount} hàng đợi (chưa liên kết Trello hoặc đang chạy)\n`
      }
      if (errors.length > 0) {
        resultMsg += `- Lỗi: ${errors.length} hàng đợi:\n  + ${errors.slice(0, 3).join('\n  +')}`
      }
      alert(resultMsg)
    } catch (err) {
      console.error('Lỗi cập nhật Trello toàn bộ:', err)
      setErrorStatus(`Lỗi cập nhật Trello toàn bộ: ${extractErrorMessage(err)}`)
    } finally {
      setSyncingAllTrello(false)
      setSyncProgress(null)
    }
  }

  const handleQuickSyncCurrentQueue = async () => {
    if (!hasDesktopBridge) return
    setErrorStatus('')
    let listId = form.trelloListId
    if (!listId && editingQueue) {
      const sel = await window.desktopApp.getTrelloSelections(editingQueue.id)
      listId = sel?.listId
    }
    if (!listId) {
      setIsTrelloModalOpen(true)
      return
    }

    setSaving(true)
    try {
      const rawPosts = await window.desktopApp.syncTrelloCards({ listId, autoWrapLink: true })
      if (!rawPosts || rawPosts.length === 0) {
        alert('Không tìm thấy thẻ bài viết nào trong danh sách Trello đã liên kết.')
        return
      }
      const newPosts = rawPosts.map((p) => ({ ...p, selected: false }))
      setForm(prev => {
        const existing = [...prev.posts]
        if (existing.length === 1 && !existing[0].content && !existing[0].imagePath && !existing[0].trelloCardId) {
          return { ...prev, posts: newPosts, trelloListId: listId }
        }
        return { ...prev, posts: [...newPosts, ...existing], trelloListId: listId }
      })
      alert(`Đã nạp trực tiếp ${newPosts.length} bài viết từ Trello vào hàng đợi!\n(Hãy tích chọn các bài viết bạn muốn đăng)`)
    } catch (err) {
      console.error('Trello modal sync error:', err)
      setErrorStatus(`Lỗi nạp Trello: ${extractErrorMessage(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleStartQueue = async (queue) => {
    if (!hasDesktopBridge) return
    if (startingIds.has(queue.id) || runningIds.includes(queue.id)) return
    setErrorStatus('')
    setStartingIds((prev) => new Set(prev).add(queue.id))
    try {
      if (!queue.posts || queue.posts.length === 0) {
        setErrorStatus('Hàng đợi chưa có thẻ/bài viết nào để đăng! Vui lòng thêm bài viết trước khi bắt đầu.')
        return
      }
      const selectedPosts = (queue.posts || []).filter(p => p.selected !== false);
      if (selectedPosts.length === 0) {
        setErrorStatus('Hàng đợi không có bài viết nào được chọn để đăng! Vui lòng chỉnh sửa hàng đợi và tích chọn ít nhất 1 bài viết.')
        return
      }
      // Validate profile still exists
      const profile = profiles.find(p => p.id === queue.profileId);
      if (!profile) {
        setErrorStatus(t('post_queue.modal.alerts.missing_profile_start'));
        return;
      }

      await window.desktopApp.startQueue(queue.id)
    } catch (error) {
      setErrorStatus(extractErrorMessage(error))
    } finally {
      setStartingIds((prev) => {
        const next = new Set(prev)
        next.delete(queue.id)
        return next
      })
    }
  }

  const handleStopQueue = async (queue) => {
    if (!hasDesktopBridge) return
    if (stoppingIds.has(queue.id)) return
    setErrorStatus('')
    setStoppingIds((prev) => new Set(prev).add(queue.id))
    try {
      await window.desktopApp.stopQueue(queue.id)
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_stopping')}${extractErrorMessage(error)}`)
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev)
        next.delete(queue.id)
        return next
      })
    }
  }

  const handleApprove = async (queue) => {
    if (!hasDesktopBridge) return
    setApprovingIds(prev => [...prev, queue.id])
    try {
      await window.desktopApp.approveQueue(queue.id)
      await loadData(true)
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_approving')}${extractErrorMessage(error)}`)
    } finally {
      setApprovingIds(prev => prev.filter(id => id !== queue.id))
    }
  }

  const handleFocusQueue = async (queue) => {
    if (!hasDesktopBridge) return
    try {
      await window.desktopApp.focusQueue(queue.id)
    } catch (error) {
      console.error(t('post_queue.modal.alerts.error_focusing'), error)
    }
  }

  const handleResetQueue = async (queue) => {
    if (!confirm(t('post_queue.modal.alerts.confirm_reset', { name: queue.name }))) return
    if (!hasDesktopBridge) return
    setErrorStatus('')
    try {
      await window.desktopApp.resetQueue(queue.id)
      await loadData(true)
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_resetting')}${extractErrorMessage(error)}`)
    }
  }

  const handleStopAll = async () => {
    if (!hasDesktopBridge) return
    setErrorStatus('')
    try {
      await window.desktopApp.stopAllQueues()
    } catch (error) {
      setErrorStatus(`${t('post_queue.modal.alerts.error_stopping_all')}${extractErrorMessage(error)}`)
    }
  }

  const handleClearAllPosts = async () => {
    if (!confirm('Bạn có chắc chắn muốn XÓA SẠCH toàn bộ bài viết trong TẤT CẢ các thẻ (hàng đợi) không? Hành động này không thể hoàn tác!')) return
    if (!hasDesktopBridge) return
    setErrorStatus('')
    try {
      for (const queue of queues) {
        if (queue.posts && queue.posts.length > 0) {
          await window.desktopApp.updateQueue(queue.id, { ...queue, posts: [], state: { currentPostIndex: 0, status: 'idle' } })
        }
      }
      await loadData(true)
    } catch (error) {
      setErrorStatus(`Lỗi khi xóa bài viết: ${extractErrorMessage(error)}`)
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
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('post_queue.title')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tighter text-[11px] font-bold">
            {t('post_queue.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative mr-2 group/search hidden md:block">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within/search:text-blue-500 transition-colors" />
            <input
              type="text"
              placeholder={t('post_queue.search_placeholder') || 'Tìm kiếm thẻ...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-48 focus:w-64"
            />
          </div>
          <button
            onClick={toggleLayout}
            className="p-2 text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 mr-2"
            title={viewLayout === 'grid' ? "Chuyển sang Bố cục Dọc" : "Chuyển sang Bố cục Ngang"}
          >
            {viewLayout === 'grid' ? <LayoutList className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
          </button>
          {runningIds.length > 0 && (
            <button
              onClick={handleStopAll}
              className="btn-secondary text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center gap-2"
            >
              <Square className="w-4 h-4" />
              {t('post_queue.buttons.stop_all')} ({runningIds.length})
            </button>
          )}
          {queues.length > 0 && (
            <button
              onClick={handleSyncAllTrello}
              disabled={syncingAllTrello || saving}
              className="btn-secondary text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 flex items-center gap-2 font-bold transition-all shadow-xs disabled:opacity-50"
              title="Cập nhật toàn bộ thẻ Trello cho tất cả các hàng đợi/profile"
            >
              {syncingAllTrello ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
              ) : (
                <DownloadCloud className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              )}
              <span className="hidden sm:inline">
                {syncingAllTrello && syncProgress
                  ? `Đang nạp (${syncProgress.current}/${syncProgress.total})...`
                  : 'Cập nhật Trello toàn bộ'}
              </span>
            </button>
          )}
          {queues.length > 0 && (
            <button
              onClick={handleClearAllPosts}
              className="btn-secondary text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800/50 hover:bg-orange-100 dark:hover:bg-orange-900/40 flex items-center gap-2"
              title="Tẩy toàn bộ bài viết trong tất cả các thẻ"
            >
              <Eraser className="w-4 h-4" />
              <span className="hidden md:inline">Tẩy toàn bộ</span>
            </button>
          )}
          <button
            onClick={openAddModal}
            disabled={saving || !readyProfiles}
            className="btn-primary flex items-center gap-2 shadow-lg shadow-blue-100 dark:shadow-none"
          >
            <Plus className="w-5 h-5" />
            {t('post_queue.buttons.create_queue')}
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

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex-1 overflow-auto p-5 transition-colors">
        {loading ? (
          <div className="py-20 text-center text-slate-400 dark:text-slate-500">{t('post_queue.loading')}</div>
        ) : filteredQueues.length === 0 ? (
          <div className="py-20 px-8 text-center text-slate-400 dark:text-slate-500 bg-slate-50/50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
            {searchQuery ? 'Không tìm thấy thẻ nào phù hợp.' : t('post_queue.empty_state')}
          </div>
        ) : (
          <div className={viewLayout === 'grid' ? "grid grid-rows-2 grid-flow-col auto-cols-[340px] gap-4 pb-4 overflow-x-auto custom-scrollbar items-stretch" : "flex flex-col gap-4 pb-10"}>
            {filteredQueues.map((queue, index) => {
              const isRunning = runningIds.includes(queue.id)
              const postCount = queue.posts?.length || 0
              const selectedCount = (queue.posts || []).filter(p => p.selected !== false).length
              const state = queue.state || { currentPostIndex: 0, status: 'idle' }
              const lastLog = queue.logs && queue.logs.length > 0 ? queue.logs[queue.logs.length - 1] : null
              const isPendingApproval = isRunning && state.status === 'pending_approval'
              const queueColor = ACCENT_COLORS[index % ACCENT_COLORS.length]
              const targetProfile = profiles.find((p) => p.id === queue.profileId)
              const isProfileRunning = runningProfileIds.has(String(queue.profileId))
              const isOpeningProfile = openingProfileIds.has(queue.profileId)

              return (
                <article
                  key={queue.id}
                  draggable={!searchQuery}
                  onDragStart={(e) => handleDragStart(e, queue.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, queue.id)}
                  onClick={() => {
                    if (draggedId) return
                    handleOpenProfile(queue.profileId)
                  }}
                  className={`rounded-2xl border border-slate-200 dark:border-slate-700 border-l-[4px] transition-all duration-300 flex flex-col group/card h-full hover:-translate-y-1 hover:shadow-lg ${queueColor} w-full cursor-pointer select-none ${
                    isRunning ? 'border-blue-300 ring-4 ring-blue-50 dark:ring-blue-900/20 bg-white dark:bg-slate-800' : 'bg-slate-50/50 dark:bg-slate-800/50'
                  } ${draggedId === queue.id ? 'opacity-50' : ''}`}
                  title={
                    isProfileRunning
                      ? "Profile đang mở - Bấm vào thẻ để chuyển đến cửa sổ trình duyệt"
                      : "Bấm vào thẻ để mở Profile"
                  }
                >
                  <div className="p-4 flex-1 pb-2 relative">
                    {/* Drag Handle */}
                    {!searchQuery && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-2 left-2 p-1 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing opacity-0 group-hover/card:opacity-100 transition-opacity"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    )}
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-2 mt-1">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate" title={queue.name}>{queue.name}</h3>
                          {queue.trelloListId && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60 shrink-0" title="Đã liên kết với Trello">
                              <Zap className="w-2.5 h-2.5 fill-current" />
                              Trello
                            </span>
                          )}
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider whitespace-nowrap shrink-0 ${
                            isRunning 
                              ? (isPendingApproval ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 ring-4 ring-orange-50 dark:ring-orange-900/20' : (state.status === 'running' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'))
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                          }`}>
                            {isRunning ? (
                              <>
                                <span className={`w-1.5 h-1.5 rounded-full bg-current ${state.status === 'running' ? 'animate-ping' : ''}`} />
                                {isPendingApproval ? t('post_queue.badges.pending_approval') : (state.status === 'running' ? t('post_queue.badges.posting') : t('post_queue.badges.waiting'))}
                              </>
                            ) : (
                              t('post_queue.badges.paused')
                            )}
                          </span>
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-tight truncate w-full flex items-center gap-1.5 flex-wrap">
                          <span className="shrink-0">{t('post_queue.labels.page')}</span>
                          <span className="text-slate-700 dark:text-slate-300 truncate font-semibold">{resolveIdentityLabel(queue)}</span>
                          {targetProfile && (
                            <span className="text-slate-400 dark:text-slate-500 shrink-0 flex items-center gap-1 text-[10px]">
                              • Profile: <span className="text-slate-700 dark:text-slate-300 font-bold">{targetProfile.name}</span>
                              {isProfileRunning && (
                                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900 animate-pulse ml-0.5" title="Trình duyệt Profile đang mở" />
                              )}
                              {isOpeningProfile && (
                                <Loader2 className="w-3 h-3 animate-spin text-emerald-600 dark:text-emerald-400 ml-0.5" />
                              )}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleQuickSyncQueue(queue)
                          }}
                          disabled={saving || isRunning}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 rounded-lg transition-colors disabled:opacity-30"
                          title="Đồng bộ trực tiếp thẻ Trello (Tức thì, không chờ tải ảnh)"
                        >
                          <DownloadCloud className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleResetQueue(queue)
                          }}
                          disabled={saving || isRunning}
                          className="p-1.5 text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/40 rounded-lg transition-colors disabled:opacity-30"
                          title={t('post_queue.tooltips.reset_process')}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setShowLogsId(queue.id)
                          }}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 rounded-lg transition-colors"
                          title={t('post_queue.tooltips.event_history')}
                        >
                          <History className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditModal(queue)
                          }}
                          disabled={saving || isRunning}
                          className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-lg transition-colors disabled:opacity-30"
                          title={t('post_queue.tooltips.edit')}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleClearPosts(queue)
                          }}
                          disabled={saving || isRunning || queue.posts.length === 0}
                          className="p-1.5 text-slate-400 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/40 rounded-lg transition-colors disabled:opacity-30"
                          title="Xóa tất cả bài viết"
                        >
                          <Eraser className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(queue)
                          }}
                          disabled={saving}
                          className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                          title={t('post_queue.tooltips.delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Info */}
                    <div className={`mt-3 rounded-2xl border p-3 transition-colors ${
                      isRunning ? 'bg-blue-50/30 dark:bg-blue-900/10 border-blue-100/50 dark:border-blue-800/50' : 'bg-white/80 dark:bg-slate-800/80 border-slate-200/60 dark:border-slate-700'
                    }`}>
                      <div className="flex items-center justify-between text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 whitespace-nowrap gap-2 overflow-hidden">
                        <span className="truncate">{t('post_queue.progress.title')}</span>
                        <span className="text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-full border border-slate-100 dark:border-slate-700 shrink-0">
                          {postCount > 0 ? (
                            selectedCount < postCount 
                              ? `${selectedCount}/${postCount} bài chọn` 
                              : t('post_queue.progress.post_count', {current: Math.min(state.currentPostIndex + 1, postCount), total: postCount})
                          ) : '0/0'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden shadow-inner p-0.5">
                          <div 
                            className="h-full bg-linear-to-r from-blue-400 to-blue-600 dark:from-blue-500 dark:to-blue-700 rounded-full transition-all duration-1000 shadow-sm"
                            style={{ width: `${postCount > 0 ? Math.min(((state.currentPostIndex) / postCount) * 100, 100) : 0}%` }}
                          />
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] font-medium text-slate-500 flex items-center gap-1 truncate whitespace-nowrap">
                        <Zap className="w-3 h-3 text-yellow-500 dark:text-yellow-600 fill-current shrink-0" />
                        <span className="shrink-0">Fanpage đăng bài:</span> 
                        <span className="text-slate-700 dark:text-slate-300 font-bold truncate flex-1">
                          {resolveIdentityLabel(queue)}
                        </span>
                      </p>
                    </div>

                    {/* Latest Log */}
                    {lastLog && (
                      <div className={`mt-2 rounded-xl border p-2 flex gap-2 items-start animate-in slide-in-from-bottom-2 duration-300 shadow-sm ${
                        lastLog.type === 'success' ? 'bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/50' : 
                        lastLog.type === 'error' ? 'bg-red-50/50 dark:bg-red-900/20 border-red-100 dark:border-red-800/50' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}>
                         <div className="mt-0.5 shrink-0">
                           {lastLog.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" /> :
                            lastLog.type === 'error' ? <AlertCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400" /> :
                            <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />}
                         </div>
                         <div className="min-w-0 flex-1">
                            <p className={`text-[11px] font-bold leading-tight line-clamp-2 ${
                              lastLog.type === 'success' ? 'text-emerald-800 dark:text-emerald-300' :
                              lastLog.type === 'error' ? 'text-red-800 dark:text-red-300' : 'text-slate-800 dark:text-slate-300'
                            }`} title={lastLog.message}>
                              {lastLog.message && lastLog.message.includes('.') ? t(lastLog.message) : lastLog.message}
                            </p>
                            <span className="text-[9px] text-slate-400 dark:text-slate-500 block mt-1 uppercase tracking-tighter font-bold">
                              {t('post_queue.logs.updated_at', {time: new Date(lastLog.timestamp).toLocaleTimeString()})}
                            </span>
                         </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="p-4 pt-0 mt-auto flex gap-2 items-stretch">
                    {isPendingApproval && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleFocusQueue(queue)
                          }}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-400 rounded-xl font-bold transition-all active:scale-95 shadow-sm border border-indigo-200 dark:border-indigo-800/50 text-xs uppercase"
                          title="Go to Browser"
                        >
                          <ExternalLink className="w-4 h-4" />
                          <span className="hidden sm:inline">{t('post_queue.buttons.browser')}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleApprove(queue)
                          }}
                          disabled={approvingIds.includes(queue.id)}
                          className="flex-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 text-white rounded-xl font-bold transition-all active:scale-95 shadow-md shadow-indigo-100 dark:shadow-none text-xs uppercase disabled:opacity-50"
                        >
                          {approvingIds.includes(queue.id) ? (
                            <RefreshCw className="w-4 h-4 animate-spin text-white" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-indigo-200" />
                          )}
                          {t('post_queue.buttons.continue')}
                        </button>
                      </>
                    )}
                    
                    {!isRunning ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStartQueue(queue)
                        }}
                        disabled={saving || startingIds.has(queue.id)}
                        className="flex-1 btn-primary py-2.5 rounded-xl flex items-center justify-center gap-2 group shadow-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 transition-all uppercase text-xs font-black tracking-widest disabled:opacity-60"
                      >
                        {startingIds.has(queue.id) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4 fill-current transition-transform group-hover:scale-110" />
                        )}
                        {t('post_queue.buttons.start_queue')}
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStopQueue(queue)
                        }}
                        disabled={saving || stoppingIds.has(queue.id)}
                        className={`${isPendingApproval ? 'w-12 px-0' : 'flex-1 py-2.5'} btn-secondary flex items-center justify-center gap-2 rounded-xl bg-slate-800 text-white border-slate-800 hover:bg-slate-900 dark:bg-slate-950 dark:hover:bg-slate-900 dark:border-slate-800 shadow-sm transition-all uppercase text-xs font-black tracking-widest disabled:opacity-60`}
                        title="Stop Queue"
                      >
                        {stoppingIds.has(queue.id) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Square className="w-4 h-4 fill-current" />
                        )}
                        {!isPendingApproval && t('post_queue.buttons.stop')}
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
                  // Extract URL if present in message
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
                          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/40 px-3 py-1.5 rounded-lg border border-blue-100 dark:border-blue-800/50"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {t('post_queue.logs.open_post_link')}
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
                  {editingQueue ? t('post_queue.modal.edit_title') : t('post_queue.modal.add_title')}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  {t('post_queue.modal.subtitle')}
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1.5 rounded-lg"><X className="w-6 h-6" /></button>
            </div>

            {/* Error inside modal */}
            {errorStatus && (
              <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm rounded-lg flex justify-between items-center animate-in fade-in duration-200">
                <span><strong>Error:</strong> {errorStatus}</span>
                <button onClick={() => setErrorStatus('')} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 font-bold ml-3 shrink-0">×</button>
              </div>
            )}

            {/* Modal body */}
            <div className="p-6 overflow-y-auto bg-slate-50/30 dark:bg-slate-900/50">
              <div className="flex flex-col gap-8">
                {/* Left side: Basic Info & Posts */}
                <div className="space-y-6 max-w-4xl mx-auto w-full">
                  <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 dark:text-slate-500 mb-1.5 uppercase tracking-widest">{t('post_queue.modal.labels.queue_name')}</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => updateForm('name', e.target.value)}
                        placeholder={t('post_queue.modal.placeholders.queue_name')}
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
                          {btvOrderedProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                  </div>

                  {/* Posts List */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                       <div className="flex items-center gap-3 flex-wrap">
                         <h4 className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('post_queue.modal.labels.post_list', {count: form.posts.length})}</h4>
                         {form.posts.length > 0 && (
                           <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
                             <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                               Đã chọn: <strong className="text-blue-600 dark:text-blue-400">{form.posts.filter(p => p.selected !== false).length}</strong>/{form.posts.length}
                             </span>
                             <span className="text-slate-300 dark:text-slate-600">•</span>
                             <button
                               type="button"
                               onClick={() => {
                                 const allSelected = form.posts.every(p => p.selected !== false);
                                 setForm(prev => ({
                                   ...prev,
                                   posts: prev.posts.map(p => ({ ...p, selected: !allSelected }))
                                 }));
                               }}
                               className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline cursor-pointer"
                             >
                               {form.posts.every(p => p.selected !== false) ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                             </button>
                           </div>
                         )}
                       </div>
                       <div className="flex items-center gap-3 flex-wrap">
                         <button type="button" onClick={handleQuickSyncCurrentQueue} disabled={saving} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 text-xs font-black uppercase tracking-tight flex items-center gap-1.5 transition-colors cursor-pointer" title="Lấy ngay toàn bộ thẻ từ danh sách Trello đã liên kết">
                           <Zap size={14} className="fill-current" />
                           Đồng bộ Trello (Tức thì)
                         </button>
                         <button
                           type="button"
                           onClick={handleAutoSpreadSchedule}
                           className={`text-xs font-black uppercase tracking-tight flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                             isSpreadOpen
                               ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                               : 'text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300'
                           }`}
                           title="Tự động giãn cách thời gian giữa các bài viết"
                         >
                           <Clock size={14} />
                           Giãn cách bài viết
                         </button>
                         <button onClick={() => setIsTrelloModalOpen(true)} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 text-xs font-black uppercase tracking-tight flex items-center gap-1">
                           <DownloadCloud size={14} />
                           Nhập từ Trello
                         </button>
                         <button onClick={addPost} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-black uppercase tracking-tight flex items-center gap-1">
                           <Plus size={14} />
                           {t('post_queue.modal.buttons.add_post')}
                         </button>
                       </div>
                    </div>

                    {isSpreadOpen && (
                      <div className="p-3.5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-center justify-between flex-wrap gap-3 animate-in fade-in duration-150">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                            <Clock size={14} className="text-amber-600 dark:text-amber-400" />
                            Chọn nhanh khoảng cách giữa các bài được tích:
                          </span>
                          {[15, 30, 45, 60, 120, 180].map((minVal) => (
                            <button
                              key={minVal}
                              type="button"
                              onClick={() => applyAutoSpreadSchedule(minVal)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                                Number(spreadMinutes) === minVal
                                  ? 'bg-amber-600 text-white border-amber-600'
                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                              }`}
                            >
                              {minVal >= 60 && minVal % 60 === 0 ? `${minVal / 60} giờ (${minVal}p)` : `${minVal} phút`}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-lg px-2.5 py-1">
                            <input
                              type="number"
                              min="1"
                              max="1440"
                              value={spreadMinutes}
                              onChange={(e) => setSpreadMinutes(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  applyAutoSpreadSchedule(spreadMinutes)
                                }
                              }}
                              className="w-14 text-center font-mono font-bold text-xs bg-transparent outline-none text-slate-800 dark:text-slate-100"
                            />
                            <span className="text-[11px] font-bold text-slate-500">phút</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => applyAutoSpreadSchedule(spreadMinutes)}
                            className="px-3 py-1.5 rounded-lg text-xs font-black uppercase bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors cursor-pointer"
                          >
                            Áp dụng
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsSpreadOpen(false)}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            title="Đóng"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                    )}
                     <div className="space-y-5 overflow-y-auto pr-2 custom-scrollbar">
                       {form.posts.map((post, index) => {
                         const isPostSelected = post.selected !== false;
                         const postColor = isPostSelected ? ACCENT_COLORS[index % ACCENT_COLORS.length] : 'border-l-slate-300 dark:border-l-slate-600';
                         return (
                         <div key={index} className={`p-5 rounded-2xl border border-slate-200 dark:border-slate-700 border-l-[4px] ${postColor} shadow-sm hover:shadow-md transition-all duration-200 relative group ${
                           isPostSelected ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/70 dark:bg-slate-900/40 opacity-75'
                         }`}>
                            <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-1 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
                               {index > 0 && (
                                <button 
                                  onClick={() => movePost(index, -1)}
                                  className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                  title="Di chuyển lên"
                                >
                                  <ArrowUp className="w-4 h-4" />
                                </button>
                               )}
                               {index < form.posts.length - 1 && (
                                <button 
                                  onClick={() => movePost(index, 1)}
                                  className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                  title="Di chuyển xuống"
                                >
                                  <ArrowDown className="w-4 h-4" />
                                </button>
                               )}
                                <button 
                                  onClick={() => removePost(index)}
                                  className="text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg ml-1 transition-colors"
                                  title="Xóa bài đăng"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex items-center justify-between mb-3">
                              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={isPostSelected}
                                  onChange={(e) => updatePost(index, 'selected', e.target.checked)}
                                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                                />
                                <span className={`text-[11px] font-black uppercase tracking-wider ${
                                  isPostSelected ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through'
                                }`}>
                                  {t('post_queue.modal.master_post', {index: index+1})}
                                </span>
                                {!isPostSelected && (
                                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 px-1.5 py-0.5 rounded">
                                    Bỏ qua khi đăng
                                  </span>
                                )}
                              </label>
                              {post.enableSchedule && isPostSelected && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60">
                                  <Clock className="w-3 h-3" />
                                  {post.scheduleType === 'delay'
                                    ? `Sau ${post.delayHours ? `${post.delayHours}h ` : ''}${post.delayMinutes || 0}p`
                                    : (() => {
                                        const p = parseScheduledTime(post.scheduledTime)
                                        return `${p.hour}:${p.minute} (${formatDateDMY(p.date)})`
                                      })()
                                  }
                                </span>
                              )}
                            </div>
                            
                            <div className="mb-4 flex flex-col gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-900/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <label className="flex items-center gap-2 text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={post.enableSchedule || false}
                                    onChange={(e) => {
                                      const checked = e.target.checked
                                      if (checked && !post.scheduledTime) {
                                        updatePost(index, 'scheduledTime', parseScheduledTime('').iso)
                                      }
                                      updatePost(index, 'enableSchedule', checked)
                                    }}
                                    className="rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600 w-4 h-4 cursor-pointer"
                                  />
                                  <span>Hẹn giờ cho bài đăng này</span>
                                </label>

                                {post.enableSchedule && (
                                  <div className="inline-flex rounded-lg bg-slate-200/80 dark:bg-slate-800 p-0.5 border border-slate-300/50 dark:border-slate-700">
                                    <button
                                      type="button"
                                      onClick={() => updatePost(index, 'scheduleType', 'exact')}
                                      className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                                        post.scheduleType !== 'delay'
                                          ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                      }`}
                                    >
                                      <Calendar className="w-3 h-3" />
                                      Mốc giờ (Đồng hồ 24h)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => updatePost(index, 'scheduleType', 'delay')}
                                      className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                                        post.scheduleType === 'delay'
                                          ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                      }`}
                                    >
                                      <Clock className="w-3 h-3" />
                                      Sau một khoảng thời gian
                                    </button>
                                  </div>
                                )}
                              </div>

                              {post.enableSchedule && (
                                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80 space-y-3">
                                  {post.scheduleType !== 'delay' ? (
                                    /* CHẾ ĐỘ 1: ĐỒNG HỒ 24 TIẾNG */
                                    (() => {
                                      const schedule = parseScheduledTime(post.scheduledTime)
                                      const updateDateTime = (newDate, newHour, newMinute) => {
                                        const iso = `${newDate}T${newHour}:${newMinute}`
                                        updatePost(index, 'scheduledTime', iso)
                                      }

                                      const addQuickOffset = (offsetMinutes) => {
                                        const target = new Date(Date.now() + offsetMinutes * 60000)
                                        const y = target.getFullYear()
                                        const m = String(target.getMonth() + 1).padStart(2, '0')
                                        const d = String(target.getDate()).padStart(2, '0')
                                        const h = String(target.getHours()).padStart(2, '0')
                                        const min = String(target.getMinutes()).padStart(2, '0')
                                        updateDateTime(`${y}-${m}-${d}`, h, min)
                                      }

                                      const setQuickDate = (daysAhead) => {
                                        const target = new Date()
                                        target.setDate(target.getDate() + daysAhead)
                                        const y = target.getFullYear()
                                        const m = String(target.getMonth() + 1).padStart(2, '0')
                                        const d = String(target.getDate()).padStart(2, '0')
                                        updateDateTime(`${y}-${m}-${d}`, schedule.hour, schedule.minute)
                                      }

                                      return (
                                        <div className="space-y-2.5">
                                          <div className="flex items-center gap-3 flex-wrap">
                                            {/* Ngày */}
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[11px] font-bold text-slate-500">Ngày:</span>
                                              <input
                                                type="date"
                                                value={schedule.date}
                                                onChange={(e) => updateDateTime(e.target.value, schedule.hour, schedule.minute)}
                                                className="input-field py-1 px-2.5 text-xs font-mono font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => setQuickDate(0)}
                                                className="px-2 py-1 text-[10px] font-bold rounded bg-slate-200/70 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
                                              >
                                                Hôm nay
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setQuickDate(1)}
                                                className="px-2 py-1 text-[10px] font-bold rounded bg-slate-200/70 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
                                              >
                                                Ngày mai
                                              </button>
                                            </div>

                                            {/* Giờ 24 tiếng */}
                                            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1">
                                              <span className="text-[11px] font-bold text-slate-500">Giờ (24h):</span>
                                              <select
                                                value={schedule.hour}
                                                onChange={(e) => updateDateTime(schedule.date, e.target.value, schedule.minute)}
                                                className="bg-transparent text-xs font-mono font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer py-0.5 px-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
                                              >
                                                {HOURS_24.map((h) => (
                                                  <option key={h} value={h} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
                                                    {h} giờ
                                                  </option>
                                                ))}
                                              </select>
                                              <span className="text-slate-400 font-bold">:</span>
                                              <select
                                                value={schedule.minute}
                                                onChange={(e) => updateDateTime(schedule.date, schedule.hour, e.target.value)}
                                                className="bg-transparent text-xs font-mono font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer py-0.5 px-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
                                              >
                                                {MINUTES_60.map((m) => (
                                                  <option key={m} value={m} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
                                                    {m} phút
                                                  </option>
                                                ))}
                                              </select>
                                            </div>
                                          </div>

                                          {/* Nút cộng giờ nhanh */}
                                          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                            <span className="text-slate-400 font-bold shrink-0">Hẹn nhanh từ bây giờ:</span>
                                            {[
                                              { label: '+15p', min: 15 },
                                              { label: '+30p', min: 30 },
                                              { label: '+1h', min: 60 },
                                              { label: '+2h', min: 120 },
                                              { label: '+4h', min: 240 },
                                              { label: '+8h', min: 480 },
                                              { label: '+12h', min: 720 },
                                              { label: '+24h', min: 1440 },
                                            ].map((item) => (
                                              <button
                                                key={item.label}
                                                type="button"
                                                onClick={() => addQuickOffset(item.min)}
                                                className="px-2 py-0.5 rounded font-mono font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 transition-colors cursor-pointer"
                                              >
                                                {item.label}
                                              </button>
                                            ))}
                                          </div>

                                          {/* Dòng tóm tắt xem trước */}
                                          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 bg-emerald-50/60 dark:bg-emerald-950/30 px-2.5 py-1.5 rounded-lg border border-emerald-200/50 dark:border-emerald-900/50">
                                            <Clock className="w-3.5 h-3.5 shrink-0" />
                                            <span>
                                              Đăng lúc: <strong>{schedule.hour}:{schedule.minute}</strong> ngày <strong>{formatDateDMY(schedule.date)}</strong> (Đồng hồ 24 tiếng)
                                            </span>
                                            {new Date(`${schedule.date}T${schedule.hour}:${schedule.minute}`).getTime() <= Date.now() && (
                                              <span className="text-amber-600 dark:text-amber-400 ml-1 text-[10px]">
                                                (Mốc giờ này đã qua, sẽ đăng ngay khi chạy)
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })()
                                  ) : (
                                    /* CHẾ ĐỘ 2: SAU MỘT KHOẢNG THỜI GIAN */
                                    (() => {
                                      const hours = Number(post.delayHours) || 0
                                      const mins = Number(post.delayMinutes) || 0
                                      const totalMin = hours * 60 + mins

                                      const setQuickDuration = (h, m) => {
                                        updatePost(index, 'delayHours', h)
                                        updatePost(index, 'delayMinutes', m)
                                      }

                                      const cumulativeMin = form.posts
                                        .slice(0, index + 1)
                                        .reduce((acc, p) => {
                                          if (p.selected === false || !p.enableSchedule || p.scheduleType !== 'delay') return acc
                                          return acc + (Number(p.delayHours) || 0) * 60 + (Number(p.delayMinutes) || 0)
                                        }, 0)

                                      const futureDate = new Date(Date.now() + (cumulativeMin || totalMin) * 60 * 1000)
                                      const timeStr = futureDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
                                      const dateStr = futureDate.toLocaleDateString('vi-VN')

                                      return (
                                        <div className="space-y-2.5">
                                          <div className="flex items-center gap-3 flex-wrap">
                                            <span className="text-[11px] font-bold text-slate-500">Chờ trước khi đăng:</span>
                                            
                                            {/* Input Giờ */}
                                            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1">
                                              <input
                                                type="number"
                                                min="0"
                                                max="999"
                                                value={post.delayHours !== undefined ? post.delayHours : 0}
                                                onChange={(e) => updatePost(index, 'delayHours', Math.max(0, parseInt(e.target.value, 10) || 0))}
                                                className="w-12 text-center font-mono font-bold text-xs bg-transparent outline-none text-slate-800 dark:text-slate-100"
                                              />
                                              <span className="text-[11px] font-bold text-slate-500">Giờ</span>
                                            </div>

                                            {/* Input Phút */}
                                            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1">
                                              <input
                                                type="number"
                                                min="0"
                                                max="59"
                                                value={post.delayMinutes !== undefined ? post.delayMinutes : 30}
                                                onChange={(e) => updatePost(index, 'delayMinutes', Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                                                className="w-12 text-center font-mono font-bold text-xs bg-transparent outline-none text-slate-800 dark:text-slate-100"
                                              />
                                              <span className="text-[11px] font-bold text-slate-500">Phút</span>
                                            </div>
                                          </div>

                                          {/* Nút chọn nhanh khoảng thời gian */}
                                          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                            <span className="text-slate-400 font-bold shrink-0">Chọn nhanh:</span>
                                            {[
                                              { label: '15 phút', h: 0, m: 15 },
                                              { label: '30 phút', h: 0, m: 30 },
                                              { label: '45 phút', h: 0, m: 45 },
                                              { label: '1 giờ', h: 1, m: 0 },
                                              { label: '2 giờ', h: 2, m: 0 },
                                              { label: '3 giờ', h: 3, m: 0 },
                                              { label: '4 giờ', h: 4, m: 0 },
                                              { label: '6 giờ', h: 6, m: 0 },
                                              { label: '12 giờ', h: 12, m: 0 },
                                              { label: '24 giờ', h: 24, m: 0 },
                                            ].map((item) => (
                                              <button
                                                key={item.label}
                                                type="button"
                                                onClick={() => setQuickDuration(item.h, item.m)}
                                                className={`px-2 py-0.5 rounded font-bold border transition-colors cursor-pointer ${
                                                  hours === item.h && mins === item.m
                                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                }`}
                                              >
                                                {item.label}
                                              </button>
                                            ))}
                                          </div>

                                          {/* Dòng tóm tắt xem trước */}
                                          <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 bg-indigo-50/60 dark:bg-indigo-950/30 px-2.5 py-1.5 rounded-lg border border-indigo-200/50 dark:border-indigo-900/50">
                                            <Clock className="w-3.5 h-3.5 shrink-0" />
                                            {totalMin === 0 ? (
                                              <span className="text-amber-600 dark:text-amber-400 font-bold">
                                                ⚡ Không chờ (Bài viết này sẽ được đăng ngay khi chạy đến)
                                              </span>
                                            ) : (
                                              <span>
                                                Chờ đúng <strong>{hours > 0 ? `${hours} giờ ` : ''}{mins > 0 ? `${mins} phút` : ''}</strong> trước khi đăng bài này.
                                                <span className="text-slate-500 dark:text-slate-400 ml-1 font-normal">
                                                  (Dự kiến nếu chạy ngay: <strong>{timeStr}</strong> ngày {dateStr} - Đồng hồ 24h)
                                                </span>
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })()
                                  )}
                                </div>
                              )}
                            </div>

                            <textarea
                              rows={6}
                              value={post.content}
                              onChange={(e) => updatePost(index, 'content', e.target.value)}
                              placeholder={t('post_queue.modal.placeholders.post_content')}
                              className="w-full bg-transparent border-none focus:ring-0 text-slate-700 dark:text-slate-200 text-sm resize-none font-medium leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none"
                            />
                            <div className="mt-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
                              {ctaList && ctaList.length > 0 && (
                                <div className="mb-2">
                                  <select
                                    className="text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg px-2 py-1 outline-none font-medium cursor-pointer"
                                    onChange={(e) => {
                                      const selectedCta = e.target.value;
                                      if (!selectedCta) return;
                                      let newText = post.commentText || '';
                                      let replaced = false;
                                      // Thử tìm tiền tố cũ để thay thế
                                      for (const c of ctaList) {
                                        if (c && newText.trim().startsWith(c.trim())) {
                                          newText = newText.replace(c, selectedCta);
                                          replaced = true;
                                          break;
                                        }
                                      }
                                      // Nếu không tìm thấy tiền tố cũ thì nối vào đầu
                                      if (!replaced) {
                                        newText = selectedCta + ' ' + newText;
                                      }
                                      updatePost(index, 'commentText', newText.trim());
                                      e.target.value = ''; // Reset select
                                    }}
                                    defaultValue=""
                                  >
                                    <option value="" disabled>-- Đổi tiền tố (CTA) --</option>
                                    {ctaList.map((c, i) => <option key={i} value={c}>{c}</option>)}
                                  </select>
                                </div>
                              )}
                              <textarea
                                rows={2}
                                value={post.commentText || ''}
                                onChange={(e) => updatePost(index, 'commentText', e.target.value)}
                                placeholder="Nội dung bình luận (ví dụ: chứa link bài viết gốc). Sẽ tự động lấy từ bài đăng nếu để trống."
                                className="w-full bg-transparent border-none text-slate-700 dark:text-slate-200 text-sm resize-none font-medium leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none p-0 focus:ring-0"
                              />
                            </div>
                             <div className="mt-3 pt-4 border-t border-slate-50 dark:border-slate-700/50 flex flex-col gap-3">
                               <div className="flex items-center gap-3">
                                 <button 
                                   onClick={() => handleBrowsePostImage(index)}
                                   className="text-xs font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-4 py-2 rounded-xl flex items-center gap-2 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
                                 >
                                   {t('post_queue.modal.buttons.browse_image')}
                                 </button>
                                 {post.imagePath && <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate flex-1 font-mono">{post.imagePath}</span>}
                               </div>
                               
                               {/* Image Container/Preview */}
                               {(post.imageBase64 || post.thumbnailUrl || post.imagePath || post.trelloCardId) && (
                                 <div className="relative w-40 h-40 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 group/img bg-slate-50 dark:bg-slate-800">
                                   <PostThumbnailPreview post={post} />
                                   <button 
                                     type="button"
                                     onClick={() => {
                                       updatePost(index, 'imagePath', '');
                                       updatePost(index, 'imageBase64', '');
                                       updatePost(index, 'thumbnailUrl', '');
                                       updatePost(index, 'imageUrl', '');
                                       updatePost(index, 'trelloCardId', '');
                                       updatePost(index, 'trelloCardName', '');
                                     }}
                                     className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-red-600 text-white rounded-full opacity-0 group-hover/img:opacity-100 transition-all z-10 cursor-pointer"
                                     title="Xóa ảnh"
                                   >
                                     <X size={14} />
                                   </button>
                                 </div>
                               )}
                             </div>
                         </div>
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
                className="btn-secondary px-8 py-3 uppercase text-xs font-black tracking-widest"
              >
                {t('post_queue.modal.buttons.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !readyProfiles}
                className="btn-primary px-10 py-3 flex items-center gap-2 shadow-xl shadow-blue-100 dark:shadow-none transition-transform active:scale-95 uppercase text-xs font-black tracking-widest"
              >
                <Save className="w-4 h-4" />
                {saving ? t('post_queue.modal.buttons.saving') : editingQueue ? t('post_queue.modal.buttons.update_config') : t('post_queue.modal.buttons.save_config')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Trello Import Modal */}
      <TrelloImportModal 
        isOpen={isTrelloModalOpen}
        onClose={() => setIsTrelloModalOpen(false)}
        queueId={editingQueue ? editingQueue.id : 'new'}
        onImport={(dataArray, extraInfo) => {
          setForm(prev => {
            const newPosts = [...prev.posts];
            const dataToInsert = (Array.isArray(dataArray) ? dataArray : [dataArray]).map((p) => ({
              ...p,
              selected: false,
            }));
            
            // If there's an empty post, replace it, otherwise append to top
            if (newPosts.length === 1 && !newPosts[0].content && !newPosts[0].imagePath && !newPosts[0].trelloCardId) {
              newPosts.splice(0, 1, ...dataToInsert);
            } else {
              newPosts.unshift(...dataToInsert);
            }
            return {
              ...prev,
              posts: newPosts,
              trelloBoardId: extraInfo?.boardId || prev.trelloBoardId,
              trelloListId: extraInfo?.listId || prev.trelloListId,
            };
          });
        }}
      />
    </div>
  )
}
