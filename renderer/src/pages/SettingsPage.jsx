import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../components/ThemeContext';
import { Settings, Globe, Moon, Sun, Link, MessageCircle, Trash2, Plus } from 'lucide-react';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [tinfosDomain, setTinfosDomain] = useState('');
  const [domainSaved, setDomainSaved] = useState(false);

  const currentLang = i18n.resolvedLanguage || i18n.language || 'vi';
  const isEn = currentLang.startsWith('en');

  const [ctaList, setCtaList] = useState([]);
  const [newCta, setNewCta] = useState('');
  const [ctaSaved, setCtaSaved] = useState(false);

  useEffect(() => {
    window.desktopApp.getTinfosConfig().then(cfg => {
      if (cfg && cfg.domain) setTinfosDomain(cfg.domain);
    }).catch(() => {});

    window.desktopApp.getCTAConfig().then(list => {
      if (Array.isArray(list)) setCtaList(list);
    }).catch(() => {});
  }, []);

  const handleSaveDomain = async () => {
    const cleaned = tinfosDomain.trim().replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0].trim();
    setTinfosDomain(cleaned);
    await window.desktopApp.saveTinfosConfig({ domain: cleaned });
    setDomainSaved(true);
    setTimeout(() => setDomainSaved(false), 2000);
  };

  const handleAddCta = () => {
    if (!newCta.trim()) return;
    setCtaList([...ctaList, newCta.trim()]);
    setNewCta('');
  };

  const handleRemoveCta = (idx) => {
    setCtaList(ctaList.filter((_, i) => i !== idx));
  };

  const handleSaveCta = async () => {
    await window.desktopApp.saveCTAConfig(ctaList);
    setCtaSaved(true);
    setTimeout(() => setCtaSaved(false), 2000);
  };

  return (
    <div className="relative h-full flex flex-col pt-2">
      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('settings.title')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Language Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/40 rounded-xl text-blue-600 dark:text-blue-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.language.label')}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {isEn ? t('settings.language.en') : t('settings.language.vi')}
                </p>
              </div>
            </div>
            
            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => i18n.changeLanguage('vi')}
                className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
                  !isEn 
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t('settings.language.vi')}
              </button>
              <button
                onClick={() => i18n.changeLanguage('en')}
                className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
                  isEn 
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t('settings.language.en')}
              </button>
            </div>
          </div>
        </div>

        {/* Theme Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 dark:bg-indigo-900/40 rounded-xl text-indigo-600 dark:text-indigo-400">
                {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.theme.label')}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {theme === 'dark' ? t('settings.theme.dark') : t('settings.theme.light')}
                </p>
              </div>
            </div>
            
            <button
              onClick={toggleTheme}
              className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold tracking-wide rounded-xl transition-colors text-sm border border-slate-200 dark:border-slate-700"
            >
              {theme === 'dark' ? t('settings.theme.light') : t('settings.theme.dark')}
            </button>
          </div>
        </div>

      </div>

      <div className="space-y-6 max-w-2xl mt-6">
        {/* Tinfos Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-50 dark:bg-green-900/40 rounded-xl text-green-600 dark:text-green-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200">Tinfosmedia</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Đăng nhập tài khoản Dash Tinfos trước khi chạy
              </p>
            </div>
          </div>

          {/* Domain input */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                <Link className="w-4 h-4" /> Cấu hình đầu web (Domain mặc định khi bọc link)
              </label>
              <input
                type="text"
                placeholder="mosaicnotes.online"
                value={tinfosDomain}
                onChange={e => setTinfosDomain(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
            <button
              onClick={handleSaveDomain}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                domainSaved
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {domainSaved ? '✓ Đã lưu' : 'Lưu'}
            </button>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => window.desktopApp.loginTinfos()}
              className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold tracking-wide rounded-xl transition-colors text-sm shadow-sm"
            >
              Đăng Nhập Tinfos
            </button>
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-rose-50 dark:bg-rose-900/40 rounded-xl text-rose-600 dark:text-rose-400">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200">Tiền tố Bình luận (CTAs)</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Các câu gọi hành động chèn trước link bình luận ngẫu nhiên
              </p>
            </div>
          </div>

          <div className="space-y-2 mt-4">
            {ctaList.map((cta, idx) => (
              <div key={idx} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">{cta}</span>
                <button
                  onClick={() => handleRemoveCta(idx)}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {ctaList.length === 0 && (
              <div className="text-center p-4 text-sm text-slate-500 italic">Chưa có tiền tố nào. (Sẽ không ghép thêm chữ trước link)</div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <input
              type="text"
              placeholder="Nhập câu tiền tố mới..."
              value={newCta}
              onChange={e => setNewCta(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCta()}
              className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-rose-500 outline-none"
            />
            <button
              onClick={handleAddCta}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex flex-row items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Thêm
            </button>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
            <button
              onClick={handleSaveCta}
              className={`px-6 py-2.5 font-bold tracking-wide rounded-xl transition-colors text-sm shadow-sm ${
                ctaSaved
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
                  : 'bg-rose-600 hover:bg-rose-700 text-white'
              }`}
            >
              {ctaSaved ? '✓ Đã lưu' : 'Lưu cấu hình CTA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
