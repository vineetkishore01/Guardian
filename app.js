// ==============================================================================
// Guardian Website Interactive Logic
// Tabs · Clipboard Copy · Screenshot Switcher
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initInstallTabs();
  initCopyButtons();
  initShowcaseGallery();
  initNavbarScrollEffect();
  initPrivacyModal();
  initGitHubStars();
  recordVisitorHit();
});

function recordVisitorHit() {
  try {
    // 1. Automation & WebDriver Detection (Puppeteer, Playwright, Selenium, Headless Chrome)
    if (navigator.webdriver) return;
    if (window.__nightmare || window._phantom || window.callPhantom || window.__selenium_unwrapped) return;

    // 2. Headless Environment Anomalies
    if (!window.screen || window.screen.width === 0 || window.screen.height === 0) return;
    if (!navigator.languages || navigator.languages.length === 0) return;

    // 3. User-Agent Crawler & Bot Filtering
    const ua = (navigator.userAgent || '').toLowerCase();
    const botPattern = /bot|crawler|spider|crawling|slurp|duckduck|baiduspider|yandex|sogou|exabot|facebot|facebookexternalhit|ia_archiver|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|screaming|censys|shodan|netcraft|preview|headless|curl|wget|python|axios|httpie|postman|whatsapp|telegram|twitter|slack|discord|applebot|linkedin/i;
    if (botPattern.test(ua)) return;

    // 4. Session Deduplication: Record at most 1 visit per browser session (prevents reload inflation)
    const sessionKey = 'guardian_visited_session';
    if (sessionStorage.getItem(sessionKey)) return;

    // 5. Persistent Device Identifier: Ensures 1 device = 1 unique visitor even across Wi-Fi & cellular
    let visitorId = localStorage.getItem('guardian_visitor_id');
    if (!visitorId) {
      visitorId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('g_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('guardian_visitor_id', visitorId);
    }

    // 6. Human Interaction & Active Dwell Verification
    // Automated crawlers parse the DOM and exit in milliseconds without human events.
    // We send the ping ONLY after a real user interaction or 3.5s of visible dwell time.
    let dispatched = false;
    function sendVerifiedHit() {
      if (dispatched) return;
      if (document.visibilityState !== 'visible') return;
      dispatched = true;
      sessionStorage.setItem(sessionKey, 'true');

      // Detach interaction listeners
      ['scroll', 'mousemove', 'click', 'touchstart', 'keydown'].forEach((evt) => {
        window.removeEventListener(evt, onUserAction);
      });

      const targetUrl = 'https://guardian-counterstill-sun-e8de.vineetkishore01.workers.dev/hit?vid=' + encodeURIComponent(visitorId);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(targetUrl);
      } else {
        fetch(targetUrl, { mode: 'cors', cache: 'no-cache', keepalive: true }).catch(() => {});
      }
    }

    let actionTimer = null;
    function onUserAction() {
      if (dispatched) return;
      // Slight debounce so synthesized bot events don't trigger instantly
      clearTimeout(actionTimer);
      actionTimer = setTimeout(sendVerifiedHit, 300);
    }

    // Listen for genuine human interaction
    window.addEventListener('scroll', onUserAction, { passive: true, once: true });
    window.addEventListener('mousemove', onUserAction, { passive: true, once: true });
    window.addEventListener('click', onUserAction, { passive: true, once: true });
    window.addEventListener('touchstart', onUserAction, { passive: true, once: true });
    window.addEventListener('keydown', onUserAction, { passive: true, once: true });

    // Fallback: 3.5 seconds of active visible reading
    setTimeout(() => {
      if (!dispatched && document.visibilityState === 'visible') {
        sendVerifiedHit();
      }
    }, 3500);

  } catch (e) {
    // Fail silently so site functionality is never impaired
  }
}

/* --------------------------------------------------------------------------
   Install Hub Tab Switching
   -------------------------------------------------------------------------- */
function initInstallTabs() {
  const tabs = document.querySelectorAll('.install-tabs .tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');

      tabs.forEach((t) => t.classList.remove('active'));
      contents.forEach((c) => c.classList.remove('active'));

      tab.classList.add('active');
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Clipboard Copying with Toast & Button State Feedback
   -------------------------------------------------------------------------- */
function initCopyButtons() {
  const copyButtons = document.querySelectorAll('[data-copy-target]');
  const toast = document.getElementById('copy-toast');
  let toastTimer = null;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message || 'Copied to clipboard! ✓';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetSelector = btn.getAttribute('data-copy-target');
      const targetElem = document.querySelector(targetSelector);
      if (!targetElem) return;

      const textToCopy = targetElem.innerText || targetElem.textContent;

      try {
        await navigator.clipboard.writeText(textToCopy.trim());
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span>✓ Copied!</span>`;
        btn.style.background = 'var(--green)';
        btn.style.color = '#ffffff';

        showToast(btn.getAttribute('data-copy-message') || 'Copied to clipboard!');

        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.background = '';
          btn.style.color = '';
        }, 2200);
      } catch (err) {
        console.error('Failed to copy: ', err);
        showToast('Press Ctrl+C to copy');
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Screenshot Gallery & Lightbox
   -------------------------------------------------------------------------- */
function initShowcaseGallery() {
  const tabs = document.querySelectorAll('.gallery-tab');
  const images = document.querySelectorAll('.screenshot-image');
  const stage = document.querySelector('.screenshot-stage');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');

  let activeIndex = 0;

  function switchTab(index) {
    tabs.forEach((t) => t.classList.remove('active'));
    images.forEach((img) => img.classList.remove('active'));

    if (tabs[index]) tabs[index].classList.add('active');
    if (images[index]) images[index].classList.add('active');
    activeIndex = index;
  }

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => switchTab(idx));
  });

  // Lightbox view
  if (stage && lightbox && lightboxImg) {
    stage.addEventListener('click', () => {
      const currentActive = images[activeIndex];
      if (currentActive) {
        lightboxImg.src = currentActive.src;
        lightbox.classList.add('open');
      }
    });
  }

  if (lightboxClose && lightbox) {
    lightboxClose.addEventListener('click', () => lightbox.classList.remove('open'));
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) lightbox.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('open')) {
        lightbox.classList.remove('open');
      }
    });
  }
}

/* --------------------------------------------------------------------------
   Navbar Elevation on Scroll
   -------------------------------------------------------------------------- */
function initNavbarScrollEffect() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      navbar.style.background = 'rgba(0, 0, 0, 0.92)';
      navbar.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.7)';
    } else {
      navbar.style.background = 'rgba(0, 0, 0, 0.7)';
      navbar.style.boxShadow = 'none';
    }
  });
}

/* --------------------------------------------------------------------------
   Privacy & Security Policy Modal
   -------------------------------------------------------------------------- */
function initPrivacyModal() {
  const privacyLink = document.getElementById('privacy-link');
  const privacyModal = document.getElementById('privacy-modal');
  const privacyClose = document.getElementById('privacy-close');
  const privacyOkBtn = document.getElementById('privacy-ok-btn');

  if (!privacyModal) return;

  function openModal(e) {
    if (e) e.preventDefault();
    privacyModal.classList.add('open');
    privacyModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    privacyModal.classList.remove('open');
    privacyModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (privacyLink) privacyLink.addEventListener('click', openModal);
  if (privacyClose) privacyClose.addEventListener('click', closeModal);
  if (privacyOkBtn) privacyOkBtn.addEventListener('click', closeModal);

  privacyModal.addEventListener('click', (e) => {
    if (e.target === privacyModal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && privacyModal.classList.contains('open')) {
      closeModal();
    }
  });
}

/* --------------------------------------------------------------------------
   Fetch Dynamic GitHub Repo Stars
   -------------------------------------------------------------------------- */
function initGitHubStars() {
  const starBtn = document.querySelector('.btn-github span');
  if (!starBtn) return;

  fetch('https://api.github.com/repos/vineetkishore01/Guardian')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && typeof data.stargazers_count === 'number' && data.stargazers_count > 0) {
        starBtn.textContent = `Star on GitHub (${data.stargazers_count})`;
      }
    })
    .catch(() => {});
}
