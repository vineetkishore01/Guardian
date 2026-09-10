// ==============================================================================
// Guardian Website Interactive Logic
// Tabs · Clipboard Copy · Screenshot Switcher
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initInstallTabs();
  initCopyButtons();
  initShowcaseGallery();
  initNavbarScrollEffect();
  recordVisitorHit();
});

function recordVisitorHit() {
  try {
    fetch('https://guardian-counterstill-sun-e8de.vineetkishore01.workers.dev/hit', {
      mode: 'cors',
      cache: 'no-cache'
    }).catch(() => {});
  } catch (e) {}
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
