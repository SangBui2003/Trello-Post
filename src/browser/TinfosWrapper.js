const { launchStealthBrowser } = require('./BrowserLauncher');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let wrapLinkPromiseChain = Promise.resolve();

async function _wrapLinkInternal(originalLink, domain = 'sofuvale.one') {
  // Use the provided domain, but if it's empty/null, use 'sofuvale.one' as default
  const targetDomain = domain || 'sofuvale.one';
  // Use a persistent session dir for Tinfosmedia so login is saved
  const userDataDir = path.join(app.getPath('userData'), 'tinfos_session');
  
  const browser = await launchStealthBrowser({
    headless: true,
    defaultViewport: null,
    userDataDir,
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  
  // Load saved cookies to restore session
  const cookiePath = path.join(app.getPath('userData'), 'tinfos_cookies.json');
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      if (cookies && cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    } catch (e) {}
  }
  
  await page.bringToFront();

  try {
    console.log('[Tinfos] Navigating to dash.tinfosmedia.com/link-wrapper...');
    await page.goto('https://dash.tinfosmedia.com/link-wrapper', { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the user to log in if they aren't
    // We check if the destination input is present. If not, wait.
    let inputFound = false;
    for (let i = 0; i < 60; i++) {
      const inputs = await page.$$('input');
      // Look for the input. Typically it might have placeholder "Destination" or similar.
      // Since we don't know the exact selector, we'll wait for the user to navigate to the wrapper page manually if they were redirected to login.
      if (page.url().includes('/link-wrapper')) {
        // Find input that is likely the destination URL
        const destInput = await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          for (const inp of inputs) {
            const ph = (inp.placeholder || '').toLowerCase();
            const id = (inp.id || '').toLowerCase();
            if (ph.includes('destination') || ph.includes('url') || ph.includes('link') || id.includes('destination')) {
              return true;
            }
          }
          return false;
        });
        
        if (destInput) {
          inputFound = true;
          break;
        }
      }
      await delay(1000);
    }

    if (!inputFound) {
      throw new Error("Timeout waiting for Tinfosmedia wrapper page to load. Please make sure you are logged in.");
    }

    // Since we don't have the exact DOM structure, we'll try to find the input by placeholder or name
    const inputHandle = await page.evaluateHandle(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      // Prefer placeholder 'Destination'
      let target = inputs.find(i => (i.placeholder || '').toLowerCase().includes('destination'));
      if (!target) target = inputs.find(i => (i.placeholder || '').toLowerCase().includes('url'));
      if (!target) target = inputs[0]; // fallback to first input
      return target;
    });

    if (!inputHandle || !inputHandle.asElement()) {
      throw new Error("Could not find Destination input field.");
    }

    // Clear and type instantly (React-compatible)
    await inputHandle.evaluate((el, link) => {
      // Bypass React's value tracker
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, link);
      } else {
        el.value = link;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, originalLink);

    // Fill Domain field if provided
    // Fill Domain field
    if (targetDomain) {
      await page.evaluate((domainValue) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const domainInput = inputs.find(i => {
          const ph = (i.placeholder || '').toLowerCase();
          const id = (i.id || '').toLowerCase();
          const name = (i.name || '').toLowerCase();
          return ph.includes('domain') || id.includes('domain') || name.includes('domain') || ph === 'example.com';
        });
        if (!domainInput) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (setter) setter.call(domainInput, domainValue);
        else domainInput.value = domainValue;
        domainInput.dispatchEvent(new Event('input', { bubbles: true }));
        domainInput.dispatchEvent(new Event('change', { bubbles: true }));
      }, targetDomain);
    }

    // Find Wrap button (usually a button, input, or div)
    const buttonHandle = await page.evaluateHandle(() => {
      const elements = Array.from(document.querySelectorAll('button, input, div[role="button"], a, div'));
      for (const el of elements) {
         const text = (el.innerText || el.value || '').trim().toLowerCase();
         if (text === 'wrap' || text === 'shorten') {
             // Return closest clickable element
             return el.closest('button') || el.closest('a') || el.closest('[role="button"]') || el;
         }
      }
      return null;
    });

    // Capture existing links before clicking Wrap
    const beforeLinks = await page.evaluate(() => document.body.innerText.match(/(https?:\/\/[^\s"'()<>]+)/g) || []);

    if (buttonHandle && buttonHandle.asElement()) {
      await buttonHandle.click();
    } else {
      // Fallback: press enter on the input field
      await inputHandle.press('Enter');
    }

    // Wait for the result link to appear. 
    console.log('[Tinfos] Waiting for wrapped link...');
    let wrappedLink = originalLink;
    
    // We'll look for the first link that:
    // 1. Is not the original link
    // 2. Is not a dash.tinfosmedia.com link
    // 3. (Optional) matches the domain if provided
    
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      const links = await page.evaluate(() => {
        // Try to find links inside the main container first
        // If not found, fall back to all links in body
        const allLinks = Array.from(document.querySelectorAll('a')).map(a => a.href)
          .concat(document.body.innerText.match(/(https?:\/\/[^\s"'()<>]+)/g) || []);
        return Array.from(new Set(allLinks)); // Unique links
      });
      
      const validLinks = links.filter(l => 
        l !== originalLink && 
        !l.includes('dash.tinfosmedia.com') && 
        !l.includes('tinfosmedia.com') &&
        (targetDomain ? l.includes(targetDomain) : true)
      );

      // If we found any valid links, and either it's different from before or we've waited enough
      if (validLinks.length > 0) {
        // The most recently wrapped link is usually the first one in the list (Top of dashboard)
        // We take the first one found in the DOM/Text
        wrappedLink = validLinks[0];
        
        // If this link is different from the top link we saw BEFORE clicking Wrap, 
        // we can be more confident it's the new one.
        const topBefore = beforeLinks.filter(l => l !== originalLink && !l.includes('dash.tinfosmedia.com'))[0];
        
        if (wrappedLink !== topBefore || i > 5) {
           break;
        }
      }
    }

    return wrappedLink;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function wrapLink(originalLink, domain = 'sofuvale.one') {
  const execute = () => _wrapLinkInternal(originalLink, domain);
  const promise = wrapLinkPromiseChain.then(execute, execute);
  wrapLinkPromiseChain = promise.catch(() => {});
  return promise;
}

async function loginTinfos() {
  const userDataDir = path.join(app.getPath('userData'), 'tinfos_session');
  const browser = await launchStealthBrowser({
    headless: false,
    defaultViewport: null,
    userDataDir,
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  
  const cookiePath = path.join(app.getPath('userData'), 'tinfos_cookies.json');
  // Load existing
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      if (cookies && cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    } catch (e) {}
  }

  await page.bringToFront();
  await page.goto('https://dash.tinfosmedia.com/login', { waitUntil: 'networkidle2' });
  
  // Periodically save cookies every 10 seconds while the window is open
  const interval = setInterval(async () => {
    try {
      if (browser.isConnected()) {
        const cookies = await page.cookies();
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
      } else {
        clearInterval(interval);
      }
    } catch (e) {
      clearInterval(interval);
    }
  }, 10000);

  // Save cookies one last time when closing
  browser.on('disconnected', async () => {
    clearInterval(interval);
  });
}

module.exports = { wrapLink, loginTinfos };
