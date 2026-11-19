const { t } = require('../utils/i18n');

/**
 * Tự động tham gia một nhóm Facebook.
 * Trả về trạng thái: "JOINED", "PENDING", "JOIN_CLICKED", "UNKNOWN", "FAILED"
 */
async function joinGroup(page, groupUrl, onStatus = () => {}, metadata = {}) {
  try {
    onStatus(t('backend.status.accessing_group_url', {url: groupUrl}), 'info');
    await page.goto(groupUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000)); // Đợi render & tránh check point

    const { checkFacebookLoginState, autoLoginFacebook } = require('../login-handler/FacebookLogin');
    const loginCheck = await checkFacebookLoginState(page, metadata?.uid);
    
    if (!loginCheck.isLoggedIn) {
      const loginSuccess = await autoLoginFacebook(page, metadata, onStatus);
      if (!loginSuccess) {
        throw new Error('Tài khoản bị văng đăng xuất và không thể tự động đăng nhập.');
      }
      // Re-navigate to the group
      onStatus(t('backend.status.accessing_group_url', {url: groupUrl}), 'info');
      await page.goto(groupUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 4000));
    }

    // Tìm nút Join hoặc Trạng thái hiện tại
    const status = await page.evaluate(async () => {
      const getBtnByAria = (labels) => {
         for (const label of labels) {
            const el = document.querySelector(`div[aria-label="${label}"], span[aria-label="${label}"]`);
            if (el) return el;
         }
         return null;
      };

      const joinBtn = getBtnByAria(["Tham gia nhóm", "Join Group"]);
      if (joinBtn) {
         joinBtn.click();
         return 'JOIN_CLICKED';
      }

      const pendingBtn = getBtnByAria(["Hủy yêu cầu tham gia nhóm", "Cancel Join Request", "Hủy yêu cầu"]);
      if (pendingBtn) {
         return 'PENDING';
      }

      const joinedBtn = getBtnByAria(["Đã tham gia", "Joined"]);
      if (joinedBtn) {
         return 'JOINED';
      }

      // Fallback: Tìm bằng innerText
      const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
      for (const btn of buttons) {
         const text = btn.innerText.trim().toLowerCase();
         if (text === 'tham gia nhóm' || text === 'join group') {
            btn.click();
            return 'JOIN_CLICKED';
         }
         if (text === 'đã tham gia' || text === 'joined') return 'JOINED';
         if (text.includes('hủy yêu cầu') || text.includes('cancel request')) return 'PENDING';
      }

      return 'UNKNOWN';
    });

    if (status === 'JOIN_CLICKED') {
      onStatus(t('backend.status.join_request_sent_url', {url: groupUrl}), 'success');
      // Đợi thêm để popup câu hỏi admin load (nếu có), tạm thời chưa điền tự động
      await new Promise((r) => setTimeout(r, 2000));
      return 'JOIN_CLICKED';
    } else if (status === 'PENDING') {
      onStatus(t('backend.status.group_pending_approval_url', {url: groupUrl}), 'info');
      return 'PENDING';
    } else if (status === 'JOINED') {
      onStatus(t('backend.status.already_member_url', {url: groupUrl}), 'info');
      return 'JOINED';
    } else {
      onStatus(t('backend.status.join_btn_not_found_url', {url: groupUrl}), 'error');
      return 'UNKNOWN';
    }
  } catch (err) {
    onStatus(t('backend.status.error_accessing_group_url', {url: groupUrl, message: err.message}), 'error');
    return 'FAILED';
  }
}

module.exports = {
  joinGroup,
};
