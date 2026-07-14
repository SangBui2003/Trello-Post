import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function PostGroupPage({ config }) {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [pages, setPages] = useState([])
  const [selectedPage, setSelectedPage] = useState('')
  const [content, setContent] = useState('')
  const [imagePath, setImagePath] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorStatus, setErrorStatus] = useState('')
  const [readyForConfirm, setReadyForConfirm] = useState(false)

  // Fetch profiles on mount and focus
  useEffect(() => {
    async function fetchProfiles() {
      if (window.desktopApp) {
        try {
          const data = await window.desktopApp.getProfiles()
          setProfiles(data)
        } catch (err) {
          console.error('Failed to fetch profiles API', err)
        }
      }
    }
    fetchProfiles()
  }, [])

  const handleBrowseImage = async () => {
    if (window.desktopApp) {
      const path = await window.desktopApp.selectImage()
      if (path) setImagePath(path)
    }
  }

  const handlePrepare = async () => {
    if (!selectedProfile) return setErrorStatus(t('post_group.alerts.missing_profile'))
    if (!content.trim()) return setErrorStatus(t('post_group.alerts.missing_content'))
    
    setErrorStatus('')
    const profileObj = profiles.find(p => p.id === selectedProfile)
    const cookieString = profileObj ? profileObj.cookieString : ''
    const pageIdentity = selectedPage || null

    setBusy(true)
    try {
      if(window.desktopApp) {
        await window.desktopApp.prepareDraft({
          content,
          imagePath,
          cookieString,
          pageIdentity,
        })
        setReadyForConfirm(true)
      }
    } catch (err) {
      setErrorStatus(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleStop = async () => {
    setBusy(true)
    setErrorStatus('')
    try {
      if(window.desktopApp) {
        await window.desktopApp.completeDraft()
        setReadyForConfirm(false)
      }
    } catch (err) {
      setErrorStatus(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleComplete = async () => {
    setBusy(true)
    setErrorStatus('')
    try {
      if(window.desktopApp) {
        await window.desktopApp.completeDraft()
        setReadyForConfirm(false)
      }
    } catch (err) {
      setErrorStatus(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">{t('post_group.title')}</h2>
          {t('post_group.subtitle')}

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">{t('post_group.labels.group_id')}</label>
            <input 
              readOnly 
              value={config?.groupUrl || ''} 
              className="input-field bg-slate-50 text-slate-500" 
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">{t('post_group.labels.select_profile')}</label>
            <select 
              value={selectedProfile} 
              onChange={async (e) => {
                const profileId = e.target.value
                setSelectedProfile(profileId)
                setSelectedPage('')
                setPages([])

                if (profileId && window.desktopApp) {
                  try {
                    const profilePages = await window.desktopApp.getProfilePages(profileId)
                    setPages(profilePages || [])
                  } catch (err) {
                    console.error('Error loading pages:', err)
                  }
                }
              }}
              disabled={busy}
              className="input-field cursor-pointer"
            >
              <option value="">{t('post_group.placeholders.select_profile')}</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {selectedProfile && pages.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{t('post_group.labels.post_as')}</label>
              <select
                value={selectedPage}
                onChange={(e) => setSelectedPage(e.target.value)}
                disabled={busy}
                className="input-field cursor-pointer"
              >
                <option value="">{t('post_group.options.personal_account')}</option>
                {pages.map((pg) => (
                  <option key={pg.id} value={pg.pageUrl}>{pg.pageName}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">{t('post_group.labels.post_content')}</label>
            <textarea 
              rows={6}
              value={content}
              onChange={e => setContent(e.target.value)}
              disabled={busy}
              placeholder={t('post_group.placeholders.post_content')}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">{t('post_group.labels.attached_image')}</label>
            <div className="flex gap-3">
              <input 
                readOnly 
                value={imagePath} 
                placeholder={t('post_group.placeholders.no_image')} 
                className="input-field flex-1 bg-slate-50 text-slate-500" 
              />
              <button 
                onClick={handleBrowseImage} 
                disabled={busy} 
                className="btn-secondary"
              >
                {t('post_group.buttons.browse')}
              </button>
              <button 
                onClick={() => setImagePath('')} 
                disabled={busy} 
                className="btn-secondary text-red-600 hover:text-red-700"
              >
                {t('post_group.buttons.clear')}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100">
          {errorStatus && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex justify-between items-center">
              <span><strong>{t('post_group.alerts.error_prefix')}</strong> {errorStatus}</span>
              <button onClick={() => setErrorStatus('')} className="text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          <div className="flex gap-4">
            {!readyForConfirm ? (
              <button 
                onClick={handlePrepare} 
                disabled={busy} 
                className="btn-primary flex-1 py-3 text-lg"
              >
                {busy && !readyForConfirm ? t('post_group.buttons.initializing') : t('post_group.buttons.prepare_draft')}
              </button>
            ) : (
              <>
                <button 
                  onClick={handleComplete} 
                  disabled={busy} 
                  className="btn-secondary flex-1 py-3 text-lg bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                >
                  {busy ? t('post_group.buttons.processing') : t('post_group.buttons.complete')}
                </button>
              </>
            )}

            {(busy || readyForConfirm) && (
              <button 
                onClick={handleStop}
                className="btn-secondary px-6 py-3 text-slate-500 hover:text-red-600 border-slate-200"
                title={t('post_group.tooltips.stop_automation')}
              >
                {t('post_group.buttons.stop')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
