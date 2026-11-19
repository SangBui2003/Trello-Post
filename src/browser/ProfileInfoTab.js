const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

/**
 * Escapes HTML special characters.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generates the full HTML page content for the Profile Info & 2FA dashboard.
 * @param {object} profile
 * @returns {string} HTML string
 */
function generateProfileInfoHtml(profile) {
  const metadata = profile.metadata || {};
  const name = profile.name || 'Profile';
  const uid = metadata.uid || '';
  const password = metadata.password || '';
  const twofa = (metadata.twofa || '').replace(/\s+/g, '').toUpperCase();
  const email = metadata.email || '';
  const emailPass = metadata.emailPass || '';
  const category = metadata.category === 'adm' ? 'Admin' : metadata.category === 'btv' ? 'BTV' : (metadata.category || '');
  const pages = Array.isArray(profile.pages) ? profile.pages : [];
  const rawCookie = metadata.rawString || profile.cookieString || '';
  const createdAtStr = profile.createdAt ? new Date(profile.createdAt).toLocaleString('vi-VN') : '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[${escapeHtml(name)}] Thông tin tài khoản & 2FA</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.7);
      --card-border: rgba(51, 65, 85, 0.8);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --emerald: #10b981;
      --emerald-bg: rgba(16, 185, 129, 0.15);
      --emerald-border: rgba(16, 185, 129, 0.3);
      --amber: #f59e0b;
      --red: #ef4444;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #090d16 0%, #0f172a 50%, #1e1b4b 100%);
      color: var(--text);
      min-height: 100vh;
      padding: 28px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .container {
      width: 100%;
      max-width: 900px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Header */
    .header-card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .avatar-icon {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: bold;
      color: #fff;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
    }

    .header-info h1 {
      font-size: 20px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.4);
    }

    .header-info p {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .grid-layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }

    @media (min-width: 768px) {
      .grid-layout {
        grid-template-columns: 1.15fr 0.85fr;
      }
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
      padding-bottom: 12px;
    }

    .card-title svg {
      width: 18px;
      height: 18px;
      color: var(--accent);
    }

    /* 2FA Section */
    .twofa-card {
      border: 1px solid var(--emerald-border);
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(30, 41, 59, 0.8) 100%);
    }

    .twofa-display-box {
      background: rgba(15, 23, 42, 0.85);
      border: 2px solid var(--emerald-border);
      border-radius: 16px;
      padding: 24px 20px;
      text-align: center;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .twofa-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 44px;
      font-weight: 800;
      letter-spacing: 6px;
      color: #34d399;
      text-shadow: 0 0 20px rgba(52, 211, 153, 0.4);
      user-select: all;
    }

    .timer-container {
      width: 100%;
      max-width: 280px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }

    .timer-bar-wrap {
      width: 100%;
      height: 6px;
      background: rgba(51, 65, 85, 0.6);
      border-radius: 999px;
      overflow: hidden;
    }

    .timer-bar-fill {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      transition: width 0.5s linear;
      border-radius: 999px;
    }

    .timer-text {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.6; }
    }

    .btn-copy-big {
      background: #10b981;
      color: #064e3b;
      font-size: 14px;
      font-weight: 700;
      padding: 10px 24px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }

    .btn-copy-big:hover {
      background: #34d399;
      transform: translateY(-1px);
    }

    .btn-copy-big:active {
      transform: translateY(0);
    }

    /* Info fields */
    .field-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .field-box {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      transition: border-color 0.15s;
    }

    .field-box:hover {
      border-color: rgba(148, 163, 184, 0.4);
    }

    .field-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13.5px;
      color: #e2e8f0;
      word-break: break-all;
      user-select: all;
    }

    .field-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      shrink: 0;
    }

    .btn-icon {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .btn-icon:hover {
      background: rgba(51, 65, 85, 0.6);
      color: #fff;
    }

    .btn-icon svg {
      width: 15px;
      height: 15px;
    }

    /* Fanpages list */
    .pages-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 160px;
      overflow-y: auto;
    }

    .page-item {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(51, 65, 85, 0.5);
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .page-name {
      font-size: 13px;
      font-weight: 500;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .page-link {
      color: #60a5fa;
      font-size: 12px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      shrink: 0;
    }

    .page-link:hover {
      text-decoration: underline;
    }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #10b981;
      color: #064e3b;
      font-weight: 600;
      font-size: 14px;
      padding: 10px 20px;
      border-radius: 999px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s;
      opacity: 0;
      z-index: 999;
      pointer-events: none;
    }

    #toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  </style>
</head>
<body>

  <div class="container">
    <!-- Header -->
    <div class="header-card">
      <div class="header-left">
        <div class="avatar-icon">${escapeHtml(name.charAt(0).toUpperCase())}</div>
        <div class="header-info">
          <h1>
            <span>${escapeHtml(name)}</span>
            ${category ? `<span class="badge">${escapeHtml(category)}</span>` : ''}
          </h1>
          <p>Tài khoản Facebook &bull; ${createdAtStr ? `Tạo lúc ${escapeHtml(createdAtStr)}` : 'Đang hoạt động'}</p>
        </div>
      </div>
      <div>
        <a href="https://www.facebook.com/" class="btn-copy-big" style="background:#2563eb; color:#fff; text-decoration:none;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          Mở Facebook
        </a>
      </div>
    </div>

    <!-- Grid Layout -->
    <div class="grid-layout">
      <!-- Left Column: 2FA & Security -->
      <div style="display:flex; flex-direction:column; gap:20px;">
        <!-- 2FA Box -->
        <div class="card twofa-card">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Mã xác thực 2FA (Live OTP)
          </div>

          ${twofa ? `
            <div class="twofa-display-box">
              <div class="twofa-code" id="twofa-code">------</div>
              
              <div class="timer-container">
                <div class="timer-bar-wrap">
                  <div class="timer-bar-fill" id="timer-bar"></div>
                </div>
                <div class="timer-text">
                  <span class="pulse-dot"></span>
                  Làm mới sau <strong id="timer-seconds" style="color:#e2e8f0; min-width:24px;">30s</strong>
                </div>
              </div>

              <button class="btn-copy-big" id="btn-copy-code" onclick="copyCurrentCode()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>Sao chép mã 2FA</span>
              </button>
            </div>

            <!-- Secret Key Row -->
            <div class="field-row" style="margin-top:6px;">
              <span class="field-label">Khóa bí mật 2FA (Secret Key)</span>
              <div class="field-box">
                <span class="field-value" style="font-size:12.5px;">${escapeHtml(twofa)}</span>
                <div class="field-actions">
                  <button class="btn-icon" title="Sao chép khóa 2FA" onclick="copyText('${escapeHtml(twofa)}', 'Khóa 2FA')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              </div>
            </div>
          ` : `
            <div style="text-align:center; padding:30px 10px; color:#94a3b8; font-size:14px;">
              Chưa lưu Khóa bảo mật 2FA cho Profile này.<br>
              <span style="font-size:12px; color:#64748b;">(Bạn có thể cập nhật trong mục Sửa Profile)</span>
            </div>
          `}
        </div>

        <!-- Fanpages -->
        ${pages.length > 0 ? `
          <div class="card">
            <div class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
              Danh sách Fanpage quản lý (${pages.length})
            </div>
            <div class="pages-list">
              ${pages.map(p => `
                <div class="page-item">
                  <span class="page-name">${escapeHtml(p.pageName || 'Fanpage')}</span>
                  ${p.pageUrl ? `
                    <a href="${escapeHtml(p.pageUrl)}" target="_blank" class="page-link">
                      Xem trang &rarr;
                    </a>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Right Column: Credentials & Cookie -->
      <div style="display:flex; flex-direction:column; gap:20px;">
        <div class="card">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Thông tin đăng nhập tài khoản
          </div>

          <!-- UID -->
          <div class="field-row">
            <span class="field-label">UID / Tên đăng nhập</span>
            <div class="field-box">
              <span class="field-value">${escapeHtml(uid || '---')}</span>
              ${uid ? `
                <div class="field-actions">
                  <button class="btn-icon" title="Sao chép UID" onclick="copyText('${escapeHtml(uid)}', 'UID')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Password -->
          <div class="field-row">
            <span class="field-label">Mật khẩu Facebook</span>
            <div class="field-box">
              <span class="field-value" id="pass-val">${password ? '••••••••••••' : '---'}</span>
              ${password ? `
                <div class="field-actions">
                  <button class="btn-icon" title="Ẩn/Hiện mật khẩu" onclick="togglePasswordVisibility()">
                    <svg id="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  </button>
                  <button class="btn-icon" title="Sao chép mật khẩu" onclick="copyText('${escapeHtml(password)}', 'Mật khẩu')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Email -->
          ${email ? `
            <div class="field-row">
              <span class="field-label">Email</span>
              <div class="field-box">
                <span class="field-value">${escapeHtml(email)}</span>
                <div class="field-actions">
                  <button class="btn-icon" title="Sao chép Email" onclick="copyText('${escapeHtml(email)}', 'Email')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              </div>
            </div>
          ` : ''}

          <!-- Email Password -->
          ${emailPass ? `
            <div class="field-row">
              <span class="field-label">Mật khẩu Email</span>
              <div class="field-box">
                <span class="field-value" id="email-pass-val">••••••••••••</span>
                <div class="field-actions">
                  <button class="btn-icon" title="Ẩn/Hiện mật khẩu Email" onclick="toggleEmailPassVisibility()">
                    <svg id="email-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  </button>
                  <button class="btn-icon" title="Sao chép mật khẩu Email" onclick="copyText('${escapeHtml(emailPass)}', 'Mật khẩu Email')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Cookie Card -->
        <div class="card">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="8" r="1"></circle><circle cx="8" cy="14" r="1"></circle><circle cx="15" cy="13" r="1"></circle></svg>
            Cookie Session
          </div>
          <div style="font-size:12.5px; color:var(--text-muted); line-height:1.5;">
            Trình duyệt tự động đồng bộ Cookie mới nhất từ Facebook vào phần mềm.
          </div>
          <button class="btn-copy-big" style="background:rgba(51, 65, 85, 0.7); color:#e2e8f0; width:100%; justify-content:center;" onclick="copyCookie()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Sao chép chuỗi Cookie
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
    <span id="toast-msg">Đã sao chép!</span>
  </div>

  <textarea id="hidden-cookie" style="display:none;">${escapeHtml(rawCookie)}</textarea>

  <script>
    const RAW_TWOFA = "${escapeHtml(twofa)}";
    const RAW_PASS = "${escapeHtml(password)}";
    const RAW_EMAIL_PASS = "${escapeHtml(emailPass)}";
    let isPassVisible = false;
    let isEmailPassVisible = false;
    let current2FACode = "";

    function showToast(msg) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toast-msg');
      toastMsg.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    }

    function copyText(text, label) {
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        showToast('Đã sao chép ' + (label || 'thông tin') + '!');
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Đã sao chép ' + (label || 'thông tin') + '!');
      });
    }

    function copyCurrentCode() {
      if (!current2FACode || current2FACode === '------') return;
      copyText(current2FACode, 'Mã 2FA (' + current2FACode + ')');
    }

    function copyCookie() {
      const val = document.getElementById('hidden-cookie').value;
      if (!val) {
        showToast('Không có cookie để sao chép.');
        return;
      }
      copyText(val, 'Cookie');
    }

    function togglePasswordVisibility() {
      isPassVisible = !isPassVisible;
      const el = document.getElementById('pass-val');
      if (el) el.innerText = isPassVisible ? RAW_PASS : '••••••••••••';
    }

    function toggleEmailPassVisibility() {
      isEmailPassVisible = !isEmailPassVisible;
      const el = document.getElementById('email-pass-val');
      if (el) el.innerText = isEmailPassVisible ? RAW_EMAIL_PASS : '••••••••••••';
    }

    /* --- Standard RFC 6238 Pure JavaScript TOTP Engine --- */
    function sha1(bytes) {
      function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }
      const len = bytes.length;
      const words = [];
      for (let i = 0; i < len; i++) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
      words[len >>> 2] |= 0x80 << (24 - (len % 4) * 8);
      words[(((len + 8) >>> 6) << 4) + 15] = len * 8;
      const w = new Array(80);
      let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
      for (let i = 0; i < words.length; i += 16) {
        let [A, B, C, D, E] = [a, b, c, d, e];
        for (let j = 0; j < 80; j++) {
          if (j < 16) w[j] = words[i + j] | 0;
          else w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
          const f = j < 20 ? (B & C) | (~B & D) : j < 40 ? B ^ C ^ D : j < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
          const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
          const t = (rotl(A, 5) + f + E + k + w[j]) | 0;
          [E, D, C, B, A] = [D, C, rotl(B, 30), A, t];
        }
        a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0; e = (e + E) | 0;
      }
      const res = new Uint8Array(20);
      for (let i = 0; i < 5; i++) {
        const val = [a, b, c, d, e][i];
        res[i * 4] = (val >>> 24) & 255;
        res[i * 4 + 1] = (val >>> 16) & 255;
        res[i * 4 + 2] = (val >>> 8) & 255;
        res[i * 4 + 3] = val & 255;
      }
      return res;
    }

    function hmacSha1(key, msg) {
      const blockSize = 64;
      if (key.length > blockSize) key = sha1(key);
      const kPadO = new Uint8Array(blockSize);
      const kPadI = new Uint8Array(blockSize);
      for (let i = 0; i < blockSize; i++) {
        const b = i < key.length ? key[i] : 0;
        kPadO[i] = b ^ 0x5c;
        kPadI[i] = b ^ 0x36;
      }
      const inner = new Uint8Array(blockSize + msg.length);
      inner.set(kPadI); inner.set(msg, blockSize);
      const innerHash = sha1(inner);
      const outer = new Uint8Array(blockSize + 20);
      outer.set(kPadO); outer.set(innerHash, blockSize);
      return sha1(outer);
    }

    function base32Decode(input) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const cleaned = input.toUpperCase().replace(/[\\s=]/g, '');
      let bits = 0, value = 0, index = 0;
      const output = new Uint8Array(Math.floor(cleaned.length * 5 / 8));
      for (let i = 0; i < cleaned.length; i++) {
        const val = alphabet.indexOf(cleaned[i]);
        if (val === -1) continue;
        value = (value << 5) | val;
        bits += 5;
        if (bits >= 8) {
          output[index++] = (value >>> (bits - 8)) & 255;
          bits -= 8;
        }
      }
      return output;
    }

    function calculateTOTP(secret) {
      try {
        const key = base32Decode(secret);
        const epoch = Math.floor(Date.now() / 1000);
        const timeStep = Math.floor(epoch / 30);
        const timeBuf = new Uint8Array(8);
        let temp = BigInt(timeStep);
        for (let i = 7; i >= 0; i--) {
          timeBuf[i] = Number(temp & 0xffn);
          temp >>= 8n;
        }
        const hmac = hmacSha1(key, timeBuf);
        const offset = hmac[19] & 0xf;
        const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000;
        return code.toString().padStart(6, '0');
      } catch (e) {
        return 'LỖI 2FA';
      }
    }

    function updateTOTP() {
      if (!RAW_TWOFA) return;

      const epoch = Math.floor(Date.now() / 1000);
      const remainingSec = 30 - (epoch % 30);

      // Re-generate OTP code
      const code = calculateTOTP(RAW_TWOFA);
      current2FACode = code;

      const codeEl = document.getElementById('twofa-code');
      if (codeEl) {
        // Format as "123 456" for readability
        codeEl.innerText = code.length === 6 ? (code.slice(0, 3) + ' ' + code.slice(3)) : code;
      }

      const timerSecEl = document.getElementById('timer-seconds');
      if (timerSecEl) {
        timerSecEl.innerText = remainingSec + 's';
      }

      const timerBarEl = document.getElementById('timer-bar');
      if (timerBarEl) {
        const pct = (remainingSec / 30) * 100;
        timerBarEl.style.width = pct + '%';
        if (remainingSec <= 5) {
          timerBarEl.style.background = '#ef4444';
        } else if (remainingSec <= 10) {
          timerBarEl.style.background = '#f59e0b';
        } else {
          timerBarEl.style.background = 'linear-gradient(90deg, #10b981, #3b82f6)';
        }
      }
    }

    // Run immediately and every 500ms
    updateTOTP();
    setInterval(updateTOTP, 500);
  </script>
</body>
</html>`;
}

/**
 * Creates and opens the Profile Info & 2FA tab in the given browser.
 * @param {import('puppeteer').Browser} browser
 * @param {object} profile
 * @returns {Promise<import('puppeteer').Page>}
 */
async function openProfileInfoTab(browser, profile) {
  const tempDir = app ? app.getPath('temp') : os.tmpdir();
  const filePath = path.join(tempDir, `postpilot_profile_${profile.id || Date.now()}.html`);
  const htmlContent = generateProfileInfoHtml(profile);
  fs.writeFileSync(filePath, htmlContent, 'utf-8');

  const infoPage = await browser.newPage();
  const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
  await infoPage.goto(fileUrl, { waitUntil: 'domcontentloaded' });
  
  return infoPage;
}

module.exports = {
  generateProfileInfoHtml,
  openProfileInfoTab,
};
