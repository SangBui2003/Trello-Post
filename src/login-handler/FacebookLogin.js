const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Checks whether Facebook is currently logged in on the page.
 * @param {import('puppeteer').Page} page
 * @param {string} [expectedUid] Optional expected UID of the profile
 * @returns {Promise<{ isLoggedIn: boolean, reason: string }>}
 */
async function checkFacebookLoginState(page, expectedUid = null) {
  if (!page || page.isClosed()) {
    return { isLoggedIn: false, reason: 'Trang đã bị đóng' };
  }

  try {
    const url = page.url() || '';

    // 1. Nếu URL rõ ràng là trang login / checkpoint / two_step
    if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/two_step') || url.includes('/recover')) {
      return { isLoggedIn: false, reason: `Đang ở URL đăng nhập/checkpoint: ${url}` };
    }

    // 2. Lấy cookies từ các domain facebook
    let cookies = [];
    try {
      cookies = await page.cookies('https://www.facebook.com', 'https://facebook.com', 'https://web.facebook.com', 'https://m.facebook.com');
    } catch {
      try {
        cookies = await page.cookies();
      } catch {
        cookies = [];
      }
    }

    const cUser = cookies.find(c => c.name === 'c_user');
    const xs = cookies.find(c => c.name === 'xs');

    // 3. Kiểm tra DOM
    const domState = await page.evaluate(() => {
      // Các ô nhập tài khoản / mật khẩu của màn hình đăng nhập
      const emailInput = document.querySelector('input[name="email"], #email, input[name="email_or_phone"]');
      const passInput = document.querySelector('input[name="pass"], #pass, input[type="password"]');
      const loginBtn = document.querySelector('[name="login"], #loginbutton');

      // Các dấu hiệu ĐANG ĐĂNG NHẬP (Thanh bar Facebook, avatar profile, menu, feed, search)
      const userNav = document.querySelector([
        'div[aria-label="Tài khoản của bạn"]',
        'div[aria-label="Your profile"]',
        'div[aria-label="Menu"]',
        'div[aria-label="Messenger"]',
        'div[aria-label="Thông báo"]',
        'div[aria-label="Notifications"]',
        '[aria-label*="Trang cá nhân"]',
        '[aria-label*="Profile"]',
        'div[role="feed"]',
        'div[role="navigation"]',
        'a[href*="/me/"]',
        'input[placeholder*="Tìm kiếm"]',
        'input[placeholder*="Search"]'
      ].join(', '));

      // Màn hình "Nhớ tài khoản" / "Tài khoản gần đây" (khi bị đăng xuất)
      const isRememberedScreen = Array.from(document.querySelectorAll('span, div, h2, h3, p')).some(el => {
        const text = (el.innerText || '').trim().toLowerCase();
        return text.includes('tài khoản gần đây') || text.includes('recent logins') || text.includes('nhấp vào ảnh đại diện');
      });

      return {
        hasLoginForm: !!((emailInput && passInput) || loginBtn),
        hasUserNav: !!userNav,
        isRememberedScreen: !!isRememberedScreen,
      };
    }).catch(() => ({ hasLoginForm: false, hasUserNav: false, isRememberedScreen: false }));

    // Nếu có form đăng nhập rõ ràng
    if (domState.hasLoginForm) {
      return { isLoggedIn: false, reason: 'Có form đăng nhập trên trang' };
    }

    // Nếu đang ở màn hình tài khoản gần đây (chưa đăng nhập)
    if (domState.isRememberedScreen) {
      return { isLoggedIn: false, reason: 'Đang ở màn hình chọn tài khoản gần đây' };
    }

    // Nếu có thanh điều hướng hoặc profile avatar của người dùng
    if (domState.hasUserNav) {
      if (expectedUid && cUser && cUser.value && String(cUser.value) !== String(expectedUid)) {
        return { isLoggedIn: true, reason: `Đã đăng nhập tài khoản (UID: ${cUser.value})` };
      }
      return { isLoggedIn: true, reason: 'Phát hiện giao diện Facebook đã đăng nhập (User Nav)' };
    }

    // Nếu có cookie c_user & xs và không ở URL login
    if (cUser && xs) {
      return { isLoggedIn: true, reason: 'Phát hiện cookie c_user và xs hợp lệ' };
    }

    if (cUser) {
      return { isLoggedIn: true, reason: 'Phát hiện cookie c_user' };
    }

    return { isLoggedIn: false, reason: 'Không tìm thấy dấu hiệu đăng nhập' };
  } catch (err) {
    return { isLoggedIn: false, reason: 'Lỗi kiểm tra trạng thái: ' + err.message };
  }
}

/**
 * Perform auto-login if the user is at the login screen.
 * @param {import('puppeteer').Page} page
 * @param {object} metadata - Contains uid, password, twofa
 * @param {Function} onStatus
 * @returns {Promise<boolean>} true if login was successful, false if unable to login
 */
async function autoLoginFacebook(page, metadata, onStatus) {
  if (!metadata || !metadata.uid || !metadata.password) {
    onStatus('Không có thông tin UID/Mật khẩu lưu trong Profile để tự động đăng nhập.', 'warning');
    return false;
  }

  // 1. Kiểm tra ngay lập tức: Nếu tài khoản ĐÃ ĐĂNG NHẬP SẴN thì tuyệt đối không logout để đăng nhập lại
  const preCheck = await checkFacebookLoginState(page, metadata.uid);
  if (preCheck.isLoggedIn) {
    onStatus('Tài khoản đã đăng nhập sẵn. Giữ nguyên phiên đăng nhập.', 'info');
    return true;
  }

  try {
    onStatus('Phát hiện Facebook chưa đăng nhập. Bắt đầu tự động đăng nhập...', 'info');

    // Chuyển hướng thẳng tới trang chủ/login để dọn dẹp các trang chặn đăng nhập
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    // Kiểm tra lại sau khi tải facebook.com (tránh trường hợp sau khi load trang thì session tự phục hồi)
    const checkAfterHome = await checkFacebookLoginState(page, metadata.uid);
    if (checkAfterHome.isLoggedIn) {
      onStatus('Tài khoản đã đăng nhập sẵn sau khi tải trang. Giữ nguyên phiên đăng nhập.', 'info');
      return true;
    }
    
    // Nếu vẫn chưa ở trang login và chưa có form login, ép sang trang login chuẩn
    if (!page.url().includes('/login')) {
      await page.goto('https://www.facebook.com/login.php', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(2000);
    }

    // Cố gắng tìm ô email
    let emailInput = await page.waitForSelector('#email, input[name="email"], input[name="email_or_phone"]', { timeout: 4000 }).catch(() => null);
    
    // Xử lý màn hình "Nhớ tài khoản" (Remembered Account)
    if (!emailInput) {
      onStatus('Đang xử lý màn hình Lưu tài khoản...', 'running');
      // Thử bấm nút "Tiếp tục", "Đăng nhập" hoặc thẻ ảnh đại diện của tài khoản cũ trong khu vực login
      await page.evaluate(() => {
        // Chỉ quét trong khu vực thẻ đăng nhập / main content, không quét header/navbar
        const loginContainer = document.querySelector('div[data-testid="royal_login_button"], form#login_form, div#loginform, [role="main"]') || document.body;
        const btns = Array.from(loginContainer.querySelectorAll('div[role="button"], button, a, div[data-testid]'));
        const continueBtn = btns.find(b => {
          if (b.closest('div[role="banner"], div[role="navigation"]')) return false;
          const t = b.innerText.trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return t === 'continue' || t === 'tiếp tục' || t === 'log in' || t === 'đăng nhập' || aria.includes('log in') || aria.includes('đăng nhập');
        });
        if (continueBtn) {
          continueBtn.click();
        } else {
          // Bấm vào ảnh đại diện trong khung login
          const avatar = loginContainer.querySelector('img[src*="scontent"]');
          if (avatar && !avatar.closest('div[role="banner"], div[role="navigation"]')) {
            if (avatar.closest('div[role="button"]')) {
              avatar.closest('div[role="button"]').click();
            } else if (avatar.closest('a')) {
              avatar.closest('a').click();
            }
          }
        }
      });
      await delay(2000);
      
      // Kiểm tra xem ô password đã hiện ra chưa
      let passInput = await page.$('#pass, input[name="pass"], input[type="password"]');
      if (!passInput) {
        // Nếu chưa, bấm "Sử dụng tài khoản khác" (Use another profile) trong khu vực login
        await page.evaluate(() => {
          const loginContainer = document.querySelector('div[data-testid="royal_login_button"], form#login_form, div#loginform, [role="main"]') || document.body;
          const btns = Array.from(loginContainer.querySelectorAll('div[role="button"], button, a'));
          const anotherBtn = btns.find(b => {
            if (b.closest('div[role="banner"], div[role="navigation"]')) return false;
            const t = b.innerText.trim().toLowerCase();
            return t.includes('another') || t.includes('khác');
          });
          if (anotherBtn) anotherBtn.click();
        });
        await delay(2000);
        emailInput = await page.$('#email, input[name="email"], input[name="email_or_phone"]');
      }
    }

    if (emailInput) {
      onStatus('Đang nhập UID/Email...', 'running');
      await page.evaluate(() => { const el = document.querySelector('#email') || document.querySelector('input[name="email"]') || document.querySelector('input[name="email_or_phone"]'); if (el) el.value = ''; });
      await page.type('#email, input[name="email"], input[name="email_or_phone"]', metadata.uid, { delay: 30 });
    }

    const passInput = await page.waitForSelector('#pass, input[name="pass"]', { timeout: 5000 }).catch(() => null);
    if (passInput) {
      onStatus('Đang nhập mật khẩu...', 'running');
      await page.evaluate(() => { const el = document.querySelector('#pass') || document.querySelector('input[name="pass"]'); if (el) el.value = ''; });
      await page.type('#pass, input[name="pass"]', metadata.password, { delay: 30 });
    } else {
      if (!emailInput) {
        onStatus('Không tìm thấy form đăng nhập.', 'error');
        return false;
      }
    }

    onStatus('Đang ấn nút đăng nhập...', 'running');
    const loginBtn = await page.$('[name="login"], #loginbutton');
    if (loginBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
        loginBtn.click()
      ]);
    } else {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
        page.keyboard.press('Enter')
      ]);
    }

    await delay(3000);

    // Kiểm tra xem có bị yêu cầu nhập 2FA / Checkpoint / Captcha không
    let isCheckpoint = false;
    let currentUrl = page.url();
    if (currentUrl.includes('checkpoint') || currentUrl.includes('two_step') || currentUrl.includes('two_factor')) {
      isCheckpoint = true;
    } else {
      isCheckpoint = await page.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        return text.includes('hai yếu tố') || text.includes('two-factor') || text.includes('mã phê duyệt') || text.includes('approvals') || text.includes('bảo mật') || text.includes('security check');
      }).catch(() => false);
    }
    
    // Nếu có 2FA hoặc màn hình Checkpoint/Bảo mật
    if (isCheckpoint) {
      if (!metadata.twofa) {
        onStatus('Facebook yêu cầu mã 2FA nhưng Profile chưa lưu mã bảo mật 2FA.', 'error');
        return false;
      }

      onStatus('Đang kiểm tra màn hình xác thực 2FA (chờ nếu cần xác nhận Captcha)...', 'running');

      let twoFaSelector = null;
      let waitedMs = 0;
      const maxWaitMs = 60000; // Chờ tối đa 60 giây nếu người dùng cần giải captcha
      let hasAlertedCaptcha = false;

      while (waitedMs < maxWaitMs) {
        // Kiểm tra xem đã đăng nhập thành công chưa (ví dụ đã vượt qua và vào thẳng trang chủ)
        const checkDone = await checkFacebookLoginState(page, metadata.uid);
        if (checkDone.isLoggedIn) {
          onStatus('Đã vượt qua màn hình bảo mật và đăng nhập thành công.', 'success');
          return true;
        }

        // Kiểm tra xem ô trường nhập mã 2FA đã xuất hiện trên màn hình chưa
        twoFaSelector = await page.evaluate(() => {
          // 1. Ô chuẩn approvals_code
          const standard = document.querySelector('input[name="approvals_code"], input#approvals_code, input[id*="approvals_code"], input[autocomplete="one-time-code"]');
          if (standard && standard.offsetParent !== null) {
            return 'input[name="approvals_code"], input#approvals_code, input[autocomplete="one-time-code"]';
          }

          // 2. Quét các ô input text / number
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]'));
          for (const input of inputs) {
            if (input.offsetParent === null) continue;
            const name = (input.name || '').toLowerCase();
            const id = (input.id || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const aria = (input.getAttribute('aria-label') || '').toLowerCase();

            // Nếu là ô captcha thì bỏ qua
            if (name.includes('captcha') || id.includes('captcha') || placeholder.includes('captcha')) {
              continue;
            }

            if (name.includes('approvals') || id.includes('approvals') || name.includes('2fa') || id.includes('2fa') || name.includes('security_code')) {
              if (input.id) return `#${CSS.escape(input.id)}`;
              if (input.name) return `input[name="${CSS.escape(input.name)}"]`;
              return 'input[type="text"]';
            }

            if (name.includes('code') || id.includes('code') || placeholder.includes('code') || placeholder.includes('mã') || aria.includes('code') || aria.includes('mã')) {
              if (input.id) return `#${CSS.escape(input.id)}`;
              if (input.name) return `input[name="${CSS.escape(input.name)}"]`;
              return 'input[type="text"]';
            }

            // Kiểm tra ngữ cảnh của form cha
            const parent = input.closest('form, [role="main"], div#content, div#checkpointBottomProvider');
            if (parent) {
              const text = (parent.innerText || '').toLowerCase();
              const is2fa = text.includes('hai yếu tố') || text.includes('two-factor') || text.includes('6-digit') || text.includes('6 chữ số') || text.includes('mã đăng nhập') || text.includes('mã phê duyệt');
              const isCaptcha = text.includes('ký tự bạn nhìn thấy') || text.includes('characters you see') || text.includes('captcha');
              if (is2fa && !isCaptcha) {
                if (input.id) return `#${CSS.escape(input.id)}`;
                if (input.name) return `input[name="${CSS.escape(input.name)}"]`;
                return 'input[type="text"]';
              }
            }
          }

          return null;
        }).catch(() => null);

        if (twoFaSelector) {
          // Đã thấy ô nhập mã 2FA trên màn hình!
          break;
        }

        // Nếu chưa thấy ô nhập mã, kiểm tra xem có màn hình Captcha không để nhắc nhở người dùng
        const isCaptchaOnScreen = await page.evaluate(() => {
          const hasCaptchaEl = !!document.querySelector('img[src*="captcha"], iframe[src*="captcha"], iframe[src*="recaptcha"], div.g-recaptcha, input[name*="captcha"]');
          const hasCaptchaText = Array.from(document.querySelectorAll('h2, h3, span, div, p')).some(el => {
            const t = (el.innerText || '').toLowerCase();
            return t.includes('nhập các ký tự') || t.includes('enter the characters') || t.includes('kiểm tra bảo mật') || t.includes('security check');
          });
          return hasCaptchaEl || hasCaptchaText;
        }).catch(() => false);

        if (isCaptchaOnScreen && !hasAlertedCaptcha) {
          onStatus('Phát hiện màn hình yêu cầu xác nhận Captcha / Kiểm tra bảo mật trước. Vui lòng hoàn thành trên trình duyệt...', 'warning');
          hasAlertedCaptcha = true;
          await page.bringToFront().catch(() => {});
        }

        await delay(2000);
        waitedMs += 2000;
      }

      if (!twoFaSelector) {
        onStatus('Không tìm thấy ô nhập mã 2FA (hoặc chưa hoàn thành xác minh Captcha).', 'error');
        return false;
      }

      // ĐÃ XÁC NHẬN CÓ Ô TRƯỜNG NHẬP MÃ: BÂY GIỜ MỚI TẠO MÃ 2FA MỚI NHẤT ĐỂ TRÁNH HẾT HẠN
      onStatus('Đã phát hiện ô nhập 2FA. Đang tạo mã 2FA mới...', 'running');
      const { TOTP } = require('totp-generator');
      let code;
      try {
        const result = await TOTP.generate(metadata.twofa.replace(/\s+/g, ''));
        code = result.otp;
      } catch (e) {
        onStatus('Mã 2FA không hợp lệ: ' + e.message, 'error');
        return false;
      }

      onStatus(`Đang nhập mã 2FA (${code})...`, 'running');
      const codeInput = await page.$(twoFaSelector);
      if (codeInput) {
        await codeInput.click();
        await delay(300);
        await codeInput.type(code, { delay: 50 });
        await delay(1000);
        
        // Find submit button
        const submitBtn = await page.$('#checkpointSubmitButton, button[value="Continue"], button[name="submit[Continue]"], button[type="submit"]');
        if (submitBtn) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            submitBtn.click()
          ]);
        } else {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            page.keyboard.press('Enter')
          ]);
        }
        await delay(3000);
        
        // Xử lý các màn hình checkpoint tiếp theo ("Lưu trình duyệt", "Đây là tôi", "Xem lại thông tin", ...)
        // Cực kỳ quan trọng: Phải chọn "Lưu trình duyệt" để Facebook ghi nhận thiết bị tin cậy và không ép logout sau khi đăng nhập
        let checkpointSteps = 0;
        const maxCheckpointSteps = 6;
        while (checkpointSteps < maxCheckpointSteps) {
          const curUrl = page.url() || '';
          if (!curUrl.includes('checkpoint') && !curUrl.includes('two_step') && !curUrl.includes('two_factor')) {
            break; // Đã thoát khỏi màn hình checkpoint hoàn toàn
          }

          checkpointSteps++;
          onStatus(`Đang xử lý bước bảo mật checkpoint (${checkpointSteps})...`, 'running');

          // 1. Kiểm tra và chọn radio "Lưu trình duyệt" (Save browser)
          await page.evaluate(() => {
            const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
            const saveRadio = radios.find(r => {
              const val = (r.value || '').toLowerCase();
              return val.includes('save') && !val.includes('dont');
            });
            if (saveRadio) {
              saveRadio.checked = true;
              saveRadio.click();
              const label = saveRadio.closest('label') || document.querySelector(`label[for="${saveRadio.id}"]`);
              if (label) label.click();
              saveRadio.dispatchEvent(new Event('input', { bubbles: true }));
              saveRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }

            const thisWasMeRadio = radios.find(r => {
              const val = (r.value || '').toLowerCase();
              return val.includes('this_was_me') || val.includes('me');
            });
            if (thisWasMeRadio) {
              thisWasMeRadio.checked = true;
              thisWasMeRadio.click();
              const label = thisWasMeRadio.closest('label') || document.querySelector(`label[for="${thisWasMeRadio.id}"]`);
              if (label) label.click();
              thisWasMeRadio.dispatchEvent(new Event('input', { bubbles: true }));
              thisWasMeRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Tìm theo text nếu giao diện dùng div[role="radio"] hoặc text tùy biến
            const allClickables = Array.from(document.querySelectorAll('label, div[role="radio"], span'));
            const saveTextEl = allClickables.find(el => {
              const t = (el.innerText || '').trim().toLowerCase();
              return (t.includes('lưu trình duyệt') || t.includes('save browser') || t.includes('nhớ trình duyệt')) && !t.includes('không lưu') && !t.includes("don't");
            });
            if (saveTextEl) saveTextEl.click();
          }).catch(() => {});

          await delay(1000);

          // 2. Tìm nút Tiếp tục / Submit / Xác nhận trên checkpoint
          const checkpointBtn = await page.$(
            '#checkpointSubmitButton, button[value="Continue"], button[name="submit[Continue]"], button[name="submit[This was me]"], button[name*="submit"], button[type="submit"], input[type="submit"]'
          );
          if (checkpointBtn) {
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
              checkpointBtn.click()
            ]);
            await delay(2500);
          } else {
            // Thử tìm nút button có text "Tiếp tục" hoặc "Continue"
            const clickedTextBtn = await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]'));
              const continueBtn = btns.find(b => {
                const t = (b.innerText || '').trim().toLowerCase();
                return t === 'tiếp tục' || t === 'continue' || t === 'bỏ qua' || t === 'skip' || t === 'đi tới bảng tin';
              });
              if (continueBtn) {
                continueBtn.click();
                return true;
              }
              return false;
            }).catch(() => false);

            if (clickedTextBtn) {
              await delay(2500);
            } else {
              break;
            }
          }
        }
      }
    }

    await delay(2000);

    // Nếu vẫn ở checkpoint URL, chủ động truy cập lại trang chủ Facebook để hoàn tất session
    if (page.url() && page.url().includes('checkpoint')) {
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await delay(3000);
    }
    const postLoginCheck = await checkFacebookLoginState(page, metadata.uid);
    if (postLoginCheck.isLoggedIn) {
      onStatus('Tự động đăng nhập thành công và đã lưu phiên làm việc an toàn!', 'success');
      return true;
    }

    const finalUrl = page.url();
    if (finalUrl.includes('/login') && !finalUrl.includes('checkpoint')) {
      onStatus('Tự động đăng nhập thất bại (sai pass hoặc bị chặn).', 'error');
      return false;
    }

    onStatus('Tự động đăng nhập hoàn tất.', 'success');
    return true;

  } catch (error) {
    onStatus('Lỗi khi tự động đăng nhập: ' + error.message, 'error');
    return false;
  }
}

module.exports = { autoLoginFacebook, checkFacebookLoginState };
