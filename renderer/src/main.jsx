import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import i18n from './i18n'

i18n.on('languageChanged', (lng) => {
  if (window.desktopApp && window.desktopApp.setLanguage) {
    window.desktopApp.setLanguage(lng)
  }
})

if (window.desktopApp && window.desktopApp.setLanguage) {
  window.desktopApp.setLanguage(i18n.language)
}
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
