import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../components/ThemeContext';
import { Settings, Globe, Moon, Sun, Link } from 'lucide-react';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [tinfosDomain, setTinfosDomain] = useState('');
  const [domainSaved, setDomainSaved] = useState(false);

  const currentLang = i18n.resolvedLanguage || i18n.language || 'vi';
  const isEn = currentLang.startsWith('en');

  useEffect(() => {
    window.desktopApp.getTinfosConfig().then(cfg => {
      if (cfg && cfg.domain) setTinfosDomain(cfg.domain);
    }).catch(() => {});
  }, []);

  const handleSaveDomain = async () => {
    await window.desktopApp.saveTinfosConfig({ domain: tinfosDomain });
    setDomainSaved(true);
    setTimeout(() => setDomainSaved(false), 2000);
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
                <Link className="w-4 h-4" /> Domain mặc định khi Wrap link
              </label>
              <input
                type="text"
                placeholder="sofuvale.one"
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
      </div>
    </div>
  );
}
