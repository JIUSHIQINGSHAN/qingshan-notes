(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const themeButton = $('[data-theme-toggle]');
  const preference = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let chosenTheme = null;
  try {
    const saved = localStorage.getItem('qs-space-theme');
    if (saved === 'light' || saved === 'dark') chosenTheme = saved;
  } catch { /* The site also works when browser storage is disabled. */ }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
    themeButton.setAttribute('aria-label', theme === 'dark' ? '切换为日间模式' : '切换为夜间模式');
    $('meta[name="theme-color"]').content = theme === 'dark' ? '#14231f' : '#f5f6f2';
  }
  applyTheme(chosenTheme || (preference.matches ? 'dark' : 'light'));
  themeButton.addEventListener('click', () => {
    chosenTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(chosenTheme);
    try { localStorage.setItem('qs-space-theme', chosenTheme); } catch {}
  });
  preference.addEventListener('change', event => {
    if (!chosenTheme) applyTheme(event.matches ? 'dark' : 'light');
  });

  const poses = {
    front: { file: './assets/penguin-front.webp', label: '正面', note: '正面 · 很高兴遇见你。' },
    side: { file: './assets/penguin-side.webp', label: '侧面', note: '侧面 · 换个角度，想法也会不同。' },
    back: { file: './assets/penguin-back.webp', label: '背面', note: '背面 · 祥云也藏在身后。' }
  };
  const poseOrder = Object.keys(poses);
  let heroPose = 'front';
  let heroRequest = 0;
  let studioRequest = 0;
  const imageCache = new Map();
  function loadImage(source) {
    if (!imageCache.has(source)) {
      const promise = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Image unavailable'));
        image.src = source;
      });
      imageCache.set(source, promise);
      promise.catch(() => imageCache.delete(source));
    }
    return imageCache.get(source);
  }
  async function setHeroPose(name) {
    if (!poses[name]) return;
    const request = ++heroRequest;
    const pose = poses[name];
    try {
      await loadImage(pose.file);
      if (request !== heroRequest) return;
      const image = $('#hero-penguin');
      image.src = pose.file;
      image.alt = '穿着祥云青衫的小企鹅，' + pose.label + '视角';
      heroPose = name;
      $$('[data-pose]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pose === name)));
      $('[data-pose-status]').textContent = '当前为' + pose.label + '视角';
      if (!reducedMotion.matches && image.animate) {
        image.animate([{ opacity: .4, transform: 'translateY(5px) rotate(0)' }, { opacity: 1, transform: 'translateY(0) rotate(-2deg)' }], { duration: 240, easing: 'ease-out' });
      }
    } catch { notify('这个角度暂时加载不了，请稍后再试。'); }
  }
  $$('[data-pose]').forEach(button => button.addEventListener('click', () => setHeroPose(button.dataset.pose)));
  $('[data-next-pose]').addEventListener('click', () => setHeroPose(poseOrder[(poseOrder.indexOf(heroPose) + 1) % poseOrder.length]));

  async function setStudioPose(name) {
    if (!poses[name]) return;
    const request = ++studioRequest;
    try {
      await loadImage(poses[name].file);
      if (request !== studioRequest) return;
      const image = $('#studio-penguin');
      image.src = poses[name].file;
      image.alt = '青衫企鹅，' + poses[name].label + '视角';
      $$('[data-studio-pose]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.studioPose === name)));
      $('[data-studio-status]').textContent = poses[name].note;
    } catch { notify('这个角度暂时加载不了，请稍后再试。'); }
  }
  $$('[data-studio-pose]').forEach(button => button.addEventListener('click', () => setStudioPose(button.dataset.studioPose)));

  const openers = new WeakMap();
  let priorOverflow = '';
  function openDialog(dialog, opener) {
    if (!dialog || dialog.open) return;
    openers.set(dialog, opener || document.activeElement);
    priorOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    dialog.querySelector('[data-close-dialog]')?.focus();
  }
  $$('[data-open-dialog]').forEach(button => button.addEventListener('click', () => openDialog(document.getElementById(button.dataset.openDialog), button)));
  $$('dialog').forEach(dialog => {
    dialog.querySelector('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const targets = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    dialog.addEventListener('close', () => {
      document.body.style.overflow = priorOverflow;
      const opener = openers.get(dialog);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    let startedOutside = false;
    const outside = event => {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener('pointerdown', event => { startedOutside = outside(event); });
    dialog.addEventListener('click', event => {
      if (event.target === dialog && startedOutside && outside(event)) dialog.close();
      startedOutside = false;
    });
    dialog.querySelectorAll('[data-close-on-link]').forEach(link => link.addEventListener('click', () => dialog.close()));
  });

  let toastTimer;
  function notify(message) {
    const toast = $('[data-toast]');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }
  $('[data-copy-link]').addEventListener('click', async event => {
    const canonical = $('link[rel="canonical"]').href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(canonical);
      notify('网址已复制，欢迎把这里分享给朋友。');
    } catch {
      const input = $('#share-url');
      input.value = canonical;
      openDialog($('#share-dialog'), event.currentTarget);
      input.focus();
      input.select();
    }
  });
})();
