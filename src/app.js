import './styles.css';
import QRCode from 'qrcode';
import { animate } from 'motion';
import { supabase, supabaseConfig } from './supabase.js';

const INBOX_USERNAME = encodeURIComponent(import.meta.env.VITE_INBOX_USERNAME || 'quietdrop');

const root = document.querySelector('#app');
let reactPageRoot = null;
let reactPageMount = null;
let reactRuntimePromise = null;

function unmountReactPage() {
  if (!reactPageRoot) return;
  reactPageRoot.unmount();
  reactPageRoot = null;
  reactPageMount = null;
}

function renderLegacyMarkup(markup) {
  unmountReactPage();
  root.innerHTML = markup;
}

async function renderReactPage(pageName, props) {
  const expectedPath = pageName === 'HomePage' ? '/' : '/public';
  if (!reactRuntimePromise) {
    reactRuntimePromise = Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./ui/PublicPages.jsx'),
    ]);
  }
  const [{ createElement }, { createRoot }, pages] = await reactRuntimePromise;
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (currentPath !== expectedPath) return;
  const PageComponent = pages[pageName];

  if (!reactPageRoot) {
    root.innerHTML = '';
    reactPageMount = document.createElement('div');
    reactPageMount.className = 'react-page-root';
    root.appendChild(reactPageMount);
    reactPageRoot = createRoot(reactPageMount);
  }
  reactPageRoot.render(createElement(PageComponent, props));
}

const animatedPages = new WeakSet();
const animatedCards = new WeakSet();
const cardEntranceObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    animate(entry.target, { opacity: [0, 1], y: [7, 0] }, { duration: 0.24, ease: 'easeOut' });
    cardEntranceObserver.unobserve(entry.target);
  }
}, { threshold: 0.08 });
const routeTransitionObserver = new MutationObserver(() => {
  document.querySelectorAll('.react-gradient-btn-mount:not([data-mounted])').forEach(el => {
    el.dataset.mounted = 'true';
    import('./ui/AppComponents.jsx').then(m => {
      m.mountGradientButton(el, { children: el.dataset.label, type: el.dataset.type, className: "w-full text-center block" });
      const form = el.closest('#auth-form');
      if (form) syncAuthSubmitButton(form);
    });
  });
  const navMount = document.getElementById('navbar-react-mount');
  if (navMount && !navMount.dataset.mounted) {
    navMount.dataset.mounted = 'true';
    import('./ui/AppComponents.jsx').then(m => m.mountNavbar(navMount, { activePath: navMount.dataset.path }));
  }
  const sidebarMount = document.getElementById('sidebar-react-mount');
  if (sidebarMount && !sidebarMount.dataset.mounted) {
    sidebarMount.dataset.mounted = 'true';
    import('./ui/AppComponents.jsx').then(m => {
       m.mountSidebar(sidebarMount, {
         activeSection: sidebarMount.dataset.section,
         onSectionChange: (s) => { state.dashboardSection = s; renderDashboard(); },
         onLogout: () => handleLogout(),
       });
    });
  }

  const page = root.firstElementChild;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (page && !animatedPages.has(page)) {
    animatedPages.add(page);
    if (!reduceMotion) animate(page, { opacity: [0, 1], y: [5, 0] }, { duration: 0.2, ease: 'easeOut' });
  }
  if (reduceMotion) return;
  root.querySelectorAll('.message-card, .public-message-card').forEach((card) => {
    if (animatedCards.has(card)) return;
    animatedCards.add(card);
    card.style.opacity = '0';
    card.style.transform = 'translateY(7px)';
    cardEntranceObserver.observe(card);
  });
});
routeTransitionObserver.observe(root, { childList: true, subtree: true });
const mobileMenuAnimations = new WeakMap();
let authLockTimer = 0;
let authLockCheckSequence = 0;
let dashboardLoadSequence = 0;
let adminMfaState = null;
let messageNotificationChannel = null;
let messageNotificationAdminId = null;
let messageNotificationStatus = 'offline';
const state = {
  user: null,
  profile: null,
  messages: [],
  comments: [],
  dashboardSection: 'inbox',
  openTabs: ['inbox', 'pending', 'approved', 'rejected', 'pinned', 'comments'],
  commentStatus: 'pending',
  modalReturnFocus: null,
  modalScrollPosition: 0,
  lastSubmissionAt: Number(localStorage.getItem('cetp-last-submit') || 0),
};

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]);

const setNotice = (message = '', kind = 'info') => {
  const notice = document.querySelector('[data-notice]');
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.kind = kind;
};

function syncAuthSubmitButton(form) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  const busy = form.dataset.authSubmitting === 'true';
  const locked = (Number(form.dataset.authLockoutUntil) || 0) > Date.now();
  button.disabled = busy || locked;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

function startAuthLockout(form, seconds) {
  const banner = form.querySelector('[data-auth-lockout]');
  const countdown = form.querySelector('[data-auth-lockout-countdown]');
  const lockedUntil = Date.now() + seconds * 1000;
  form.dataset.authLockoutUntil = String(lockedUntil);
  if (authLockTimer) window.clearInterval(authLockTimer);

  const updateCountdown = () => {
    if (!form.isConnected) {
      window.clearInterval(authLockTimer);
      authLockTimer = 0;
      return;
    }
    const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
    if (!remaining) {
      window.clearInterval(authLockTimer);
      authLockTimer = 0;
      delete form.dataset.authLockoutUntil;
      syncAuthSubmitButton(form);
      if (banner?.isConnected) banner.hidden = true;
      setNotice('You can try signing in again.');
      return;
    }

    const timeText = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    if (banner?.isConnected) banner.hidden = false;
    if (countdown?.isConnected) countdown.textContent = timeText;
    syncAuthSubmitButton(form);
    setNotice('Too many failed attempts. Wait for the timer before trying again.', 'error');
  };

  updateCountdown();
  authLockTimer = window.setInterval(updateCountdown, 1000);
}

async function refreshAdminLockout(form) {
  const emailInput = form.elements.namedItem('email');
  const email = String(emailInput?.value || '').trim();
  if (!supabase || !email || !emailInput?.checkValidity()) return;

  const requestSequence = ++authLockCheckSequence;
  const response = await fetch('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'check-lockout', email }),
  });
  const data = await response.json().catch(() => ({}));
  const error = response.ok ? null : new Error(data.message || 'Unable to check sign-in status.');
  if (error || !form.isConnected || requestSequence !== authLockCheckSequence) return;
  if (String(emailInput.value || '').trim() !== email) return;

  const retryAfterSeconds = Number(data?.retryAfterSeconds) || 0;
  if (data?.locked && retryAfterSeconds > 0) startAuthLockout(form, retryAfterSeconds);
}

function getPublicLink(username = '') {
  return `${window.location.origin}/message/${encodeURIComponent(username || state.profile?.username || 'quietdrop')}`;
}

function getMaxUploadSizeMb() {
  const size = Number(import.meta.env.VITE_MAX_IMAGE_MB || 5);
  return Number.isFinite(size) ? size : 5;
}

function validateMediaFile(file) {
  if (!file) return;
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Choose a JPG, PNG, WebP, GIF, MP4, or WebM file.');
  }
  const maxBytes = getMaxUploadSizeMb() * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File must be smaller than ${getMaxUploadSizeMb()} MB.`);
  }
}

function formatRelativeTime(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function isMediaExpired(record) {
  return Boolean(record.media_expired || (record.media_path && record.media_expires_at && Date.parse(record.media_expires_at) <= Date.now()));
}

function publicNavbar(activePath = window.location.pathname) {
  return `<div id="navbar-react-mount" data-path="${escapeHtml(activePath)}"></div>`;
}

function setMobileNavOpen(nav, open) {
  const toggle = nav.querySelector('[data-action="toggle-nav"]');
  const menu = nav.querySelector('.nav-actions');
  if (!toggle || !menu) return;

  mobileMenuAnimations.get(menu)?.stop();
  mobileMenuAnimations.delete(menu);
  menu.style.removeProperty('height');
  menu.style.removeProperty('opacity');
  menu.style.removeProperty('overflow');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nav.classList.toggle('menu-open', open);
    (open ? menu.querySelector('a') : toggle)?.focus();
    return;
  }

  if (open) {
    nav.classList.add('menu-open');
    menu.style.height = '0px';
    menu.style.overflow = 'hidden';
    const transition = animate(menu, { height: [0, menu.scrollHeight], opacity: [0, 1] }, { duration: 0.2, ease: 'easeOut' });
    mobileMenuAnimations.set(menu, transition);
    menu.querySelector('a')?.focus();
    transition.finished.then(() => {
      if (mobileMenuAnimations.get(menu) !== transition) return;
      menu.style.height = 'auto';
      menu.style.overflow = '';
      mobileMenuAnimations.delete(menu);
    });
    return;
  }

  toggle.focus();
  menu.style.height = `${menu.getBoundingClientRect().height}px`;
  menu.style.overflow = 'hidden';
  const transition = animate(menu, { height: [menu.scrollHeight, 0], opacity: [1, 0] }, { duration: 0.16, ease: 'easeIn' });
  mobileMenuAnimations.set(menu, transition);
  transition.finished.then(() => {
    if (mobileMenuAnimations.get(menu) !== transition) return;
    nav.classList.remove('menu-open');
    menu.style.height = '';
    menu.style.overflow = '';
    menu.style.removeProperty('opacity');
    mobileMenuAnimations.delete(menu);
  });
}

function stopMessageNotifications() {
  if (messageNotificationChannel && supabase) supabase.removeChannel(messageNotificationChannel);
  messageNotificationChannel = null;
  messageNotificationAdminId = null;
  messageNotificationStatus = 'offline';
}

function subscribeToMessageNotifications(adminId) {
  if (!supabase || (messageNotificationChannel && messageNotificationAdminId === adminId)) return;
  stopMessageNotifications();
  messageNotificationAdminId = adminId;
  messageNotificationStatus = 'connecting';
  messageNotificationChannel = supabase
    .channel(`admin-message-notifications-${adminId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `admin_id=eq.${adminId}`,
    }, (payload) => {
      if (state.user?.id !== adminId || window.location.pathname !== '/admin/dashboard') return;

      renderDashboard('A new message just arrived.');
    })
    .subscribe((status) => {
      messageNotificationStatus = status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'connecting';
      const statusNode = document.querySelector('[data-realtime-status]');
      if (!statusNode) return;
      statusNode.textContent = messageNotificationStatus === 'connected' ? 'Live updates connected' : messageNotificationStatus === 'error' ? 'Live updates unavailable' : 'Connecting to live updates';
      statusNode.dataset.status = messageNotificationStatus;
    });
}

function notificationPermission() {
  if (typeof Notification === 'undefined' || !window.isSecureContext) return 'unavailable';
  return Notification.permission;
}

function notificationButtonMarkup() {
  const permission = notificationPermission();
  const labels = {
    granted: 'Test notifications',
    denied: 'Notifications blocked',
    default: 'Enable notifications',
    unavailable: 'Notifications unavailable',
  };
  const disabled = permission === 'denied' || permission === 'unavailable';
  return `<button class="secondary-button" data-action="enable-notifications" ${disabled ? 'disabled' : ''}>${labels[permission]}</button>`;
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

async function enablePushNotifications() {
  if (!state.user || !supabase) throw new Error('Sign in to enable notifications.');
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are unavailable in this browser. On iPhone or iPad, install this site to your Home Screen and open it there.');
  }

  const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY;
  if (!publicKey) throw new Error('Push notifications are not configured yet. Add the VITE_WEB_PUSH_PUBLIC_KEY setting and redeploy the app.');

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted. Check this site’s notification settings.');

  const registration = await navigator.serviceWorker.register('/service-worker.js');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    admin_id: state.user.id,
    endpoint: subscription.endpoint,
    subscription: subscription.toJSON(),
  }, { onConflict: 'admin_id,endpoint' });
  if (error) throw error;

  const readyRegistration = await navigator.serviceWorker.ready;
  await readyRegistration.showNotification('Notifications are working', {
    body: 'This device can display notifications. New messages will trigger alerts.',
    icon: '/logo.jpg',
    tag: 'notification-setup-test',
  });
}

function realtimeStatusMarkup() {
  const labels = { connected: 'Live updates connected', error: 'Live updates unavailable', connecting: 'Connecting to live updates', offline: 'Live updates offline' };
  return `<span class="realtime-status" data-realtime-status data-status="${messageNotificationStatus}">${labels[messageNotificationStatus]}</span>`;
}

function backButton(label = 'Back to Home') {
  return `<a class="back-button" href="/" aria-label="${escapeHtml(label)}">&larr; ${escapeHtml(label)}</a>`;
}

function mediaUploadControl(inputId, inputName, accept, detail = 'Images or video · Max 5 MB') {
  return `<div class="media-upload-control rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 transition hover:border-violet-400 hover:bg-violet-50/50">
    <label class="media-upload-label" for="${inputId}"><span class="media-upload-icon" aria-hidden="true">+</span><span><strong>Attach media</strong><small>${escapeHtml(detail)}</small></span></label>
    <input class="media-file-input w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700 focus-visible:outline-2 focus-visible:outline-violet-500" id="${inputId}" name="${inputName}" type="file" accept="${accept}" />
  </div>`;
}

async function renderHome() {
  await renderReactPage('HomePage', { inboxUrl: `/message/${INBOX_USERNAME}` });
}

function renderAuth(mode = 'login') {
  const content = mode === 'forgot'
    ? `<p class="eyebrow">Account recovery</p><h1>Reset your password</h1><form id="forgot-password-form" class="stack-form"><label>Email<input name="email" type="email" autocomplete="email" required /></label><div class="notice" data-notice aria-live="polite"></div><div class="react-gradient-btn-mount" data-label="Send reset link" data-type="submit" style="width:100%"></div><a class="auth-secondary-link" href="/admin/login">Back to sign in</a></form>`
    : mode === 'reset'
      ? `<p class="eyebrow">Account recovery</p><h1>Choose a new password</h1><form id="reset-password-form" class="stack-form"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required /></label><label>Confirm password<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required /></label><div class="notice" data-notice aria-live="polite"></div><div class="react-gradient-btn-mount" data-label="Update password" data-type="submit" style="width:100%"></div></form>`
      : mode === 'mfa'
        ? `<p class="eyebrow">Two-step verification</p><h1>${adminMfaState?.type === 'enroll' ? 'Set up an authenticator' : 'Verify it is you'}</h1>${adminMfaState?.type === 'enroll' ? `<p class="auth-helper">Scan this QR code with an authenticator app, then enter its current six-digit code.</p><img class="auth-mfa-qr" src="${escapeHtml(adminMfaState.qrCode)}" alt="Authenticator setup QR code" /><p class="auth-helper">Can’t scan it? Enter this setup key: <code>${escapeHtml(adminMfaState.secret)}</code></p>` : '<p class="auth-helper">Enter the six-digit code from your authenticator app.</p>'}<form id="auth-mfa-form" class="stack-form"><label>Authenticator code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label><div class="notice" data-notice aria-live="polite"></div><div class="react-gradient-btn-mount" data-label="Verify and continue" data-type="submit" style="width:100%"></div></form>`
        : `<p class="eyebrow">Admin login</p><h1>Welcome back</h1><form id="auth-form" class="stack-form"><label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" minlength="8" autocomplete="current-password" required /></label><div class="auth-lockout" data-auth-lockout role="status" aria-live="polite" hidden><span>Sign-in temporarily paused</span><strong data-auth-lockout-countdown>05:00</strong></div><div class="notice" data-notice aria-live="polite"></div><div class="react-gradient-btn-mount" data-label="Sign in" data-type="submit" style="width:100%"></div><a class="auth-secondary-link" href="/admin/login?mode=forgot">Forgot password?</a></form>`;
  root.innerHTML = `
    <main class="auth-page">
      ${publicNavbar('/admin/login')}
      <div class="auth-panel">${content}</div>
    </main>
  `;
  const loginForm = root.querySelector('#auth-form');
  loginForm?.elements.namedItem('email')?.addEventListener('blur', () => {
    refreshAdminLockout(loginForm);
  });
}

async function requireAdminMfa() {
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  if (assurance.currentLevel === 'aal2') return true;

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) throw factorsError;
  const verifiedFactor = factors.totp?.find((factor) => factor.status === 'verified');
  if (verifiedFactor) {
    adminMfaState = { type: 'challenge', factorId: verifiedFactor.id };
  } else {
    const pendingFactor = factors.totp?.find((factor) => factor.status !== 'verified');
    if (pendingFactor) {
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: pendingFactor.id });
      if (removeError) throw removeError;
    }
    const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Admin authenticator ${Date.now()}`,
    });
    if (enrollmentError) throw enrollmentError;
    adminMfaState = {
      type: 'enroll',
      factorId: enrollment.id,
      secret: enrollment.totp.secret,
      qrCode: await QRCode.toDataURL(enrollment.totp.uri),
    };
  }
  renderAuth('mfa');
  return false;
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const form = event.target instanceof HTMLFormElement ? event.target : event.target.closest('form');
  const email = String(new FormData(form).get('email') || '').trim();
  setNotice('Sending reset link…');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/admin/login?mode=reset`,
  });
  setNotice(error ? error.message : 'If an account exists for that email, a password reset link is on its way.', error ? 'error' : 'success');
}

async function handlePasswordUpdate(event) {
  event.preventDefault();
  const form = event.target instanceof HTMLFormElement ? event.target : event.target.closest('form');
  const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.confirmPassword) {
    setNotice('The passwords do not match.', 'error');
    return;
  }

  setNotice('Updating password…');
  const { error } = await supabase.auth.updateUser({ password: values.password });
  if (error) {
    setNotice(error.message, 'error');
    return;
  }
  await supabase.auth.signOut();
  state.user = null;
  adminMfaState = null;
  window.history.replaceState(null, '', '/admin/login');
  renderAuth('login');
  setNotice('Your password was updated. Sign in with your new password.');
}

async function handleMfaSubmit(event) {
  event.preventDefault();
  if (!adminMfaState) {
    setNotice('The verification step expired. Sign in again.', 'error');
    return;
  }
  const form = event.target instanceof HTMLFormElement ? event.target : event.target.closest('form');
  const code = String(new FormData(form).get('code') || '').trim();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: adminMfaState.factorId,
    code,
  });
  if (error) {
    setNotice(error.message || 'That code could not be verified. Try the current code from your authenticator.', 'error');
    return;
  }
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance.currentLevel !== 'aal2') {
    setNotice(assuranceError?.message || 'Two-step verification was not completed.', 'error');
    return;
  }
  adminMfaState = null;
  window.history.replaceState(null, '', '/admin/dashboard');
  await route();
}

async function loadProfileForUser() {
  if (!supabase || !state.user) {
    state.profile = null;
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', state.user.id)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  state.profile = data || null;
  return data;
}

async function renderDashboard(noticeMessage = '') {
  if (!supabase || !state.user) {
    renderAuth('login');
    return;
  }
  try {
    if (!await requireAdminMfa()) return;
  } catch (error) {
    renderAuth('login');
    setNotice(error.message || 'Two-step verification is unavailable. Please try again.', 'error');
    return;
  }

  const loadSequence = ++dashboardLoadSequence;
  const adminId = state.user.id;
  const isCurrentDashboardLoad = () => loadSequence === dashboardLoadSequence
    && state.user?.id === adminId
    && window.location.pathname === '/admin/dashboard';

  root.innerHTML = '<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Admin workspace</p><h1>Loading your inbox…</h1></div></main>';

  try {
    await loadProfileForUser();
    if (!isCurrentDashboardLoad()) return;
    if (!state.profile) {
      root.innerHTML = '<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Admin profile unavailable</p><h1>No inbox is linked to this account.</h1><p class="subcopy">Ask the project administrator to link this account to an existing inbox.</p></div></main>';
      return;
    }

    const [{ data: messages, error: messageError }, { data: moderationCounts, error: countsError }] = await Promise.all([
      supabase.from('messages').select('*').eq('admin_id', adminId).order('created_at', { ascending: false }),
      supabase.rpc('get_moderation_counts'),
    ]);
    if (!isCurrentDashboardLoad()) return;
    if (messageError) throw messageError;
    if (countsError) throw countsError;
    state.messages = messages || [];

    const messageIds = state.messages.map(m => m.id);
    let comments = [];
    if (messageIds.length > 0) {
      for (let i = 0; i < messageIds.length; i += 100) {
        const chunk = messageIds.slice(i, i + 100);
        const { data, error: commentError } = await supabase.rpc('get_admin_comments', {
          p_message_ids: chunk,
        });
        if (!isCurrentDashboardLoad()) return;
        if (commentError) throw commentError;
        comments.push(...(data || []));
      }
      comments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    state.comments = comments;

    const dbCounts = moderationCounts?.[0] || {};
    const counts = {
      pending: Number(dbCounts.pending_messages) || 0,
      approved: Number(dbCounts.approved_messages) || 0,
      rejected: Number(dbCounts.rejected_messages) || 0,
      pinned: Number(dbCounts.pinned_messages) || 0,
      pendingComments: Number(dbCounts.pending_comments) || 0,
    };
    const linkUrl = getPublicLink(state.profile.username);
    const sections = [
      ['inbox', 'Inbox'], ['pending', 'Pending'], ['approved', 'Approved'],
      ['rejected', 'Rejected'], ['pinned', 'Pinned'], ['comments', `Comments (${counts.pendingComments})`],
    ];

    let visibleMessages = state.messages;
    if (state.dashboardSection === 'pending' || state.dashboardSection === 'approved' || state.dashboardSection === 'rejected') {
      visibleMessages = state.messages.filter((message) => message.status === state.dashboardSection);
    } else if (state.dashboardSection === 'pinned') {
      visibleMessages = state.messages.filter((message) => message.is_pinned);
    }

    const commentRows = state.comments.filter((comment) => comment.status === state.commentStatus);
    const commentsPanel = `
      <div class="comment-filters" role="group" aria-label="Comment status">
        ${['pending', 'approved', 'rejected'].map((status) => `<button class="${state.commentStatus === status ? 'active' : ''}" data-comment-status="${status}">${status[0].toUpperCase()}${status.slice(1)} (${state.comments.filter((comment) => comment.status === status).length})</button>`).join('')}
      </div>
      <div class="message-list">
        ${commentRows.length ? commentRows.map((comment) => {
          const parent = state.messages.find((message) => message.id === comment.message_id);
          return `<article class="message-card">
            <div class="message-topline"><span class="status status-${comment.status}">${comment.status}</span><time>${escapeHtml(formatRelativeTime(comment.created_at))}</time></div>
            <p class="context-copy">Confession: ${escapeHtml(parent?.message || 'Message unavailable')}</p>
              <p>${escapeHtml(comment.comment_text || 'Response with media attachment')}</p>
              ${isMediaExpired(comment) ? '<p class="media-fallback">Media expired</p>' : ''}
            <div class="message-actions">
              ${comment.status !== 'approved' ? `<button data-action="moderate-comment" data-id="${comment.id}" data-status="approved">Approve</button>` : '<button data-action="moderate-comment" data-id="' + comment.id + '" data-status="pending">Remove from Public</button>'}
              ${comment.status !== 'rejected' ? `<button data-action="moderate-comment" data-id="${comment.id}" data-status="rejected">Reject</button>` : ''}
              <button class="danger-action" data-action="delete-comment" data-id="${comment.id}">Delete</button>
            </div>
          </article>`;
        }).join('') : '<div class="empty-state">No comments in this section.</div>'}
      </div>
    `;

    root.innerHTML = `
      <main class="dashboard-shell">
        <aside class="sidebar" style="padding:0; background:transparent; border:none; box-shadow:none; overflow:hidden;" id="sidebar-react-mount" data-section="${state.dashboardSection}"></aside>
        <section class="dashboard-content">
          <header class="dashboard-header">
            <div><p class="eyebrow">Moderation workspace</p><h1>${escapeHtml(state.profile.username)}'s inbox</h1></div>
            <div class="dashboard-header-actions">${realtimeStatusMarkup()}${notificationButtonMarkup()}<button class="secondary-button" data-action="refresh-dashboard">Refresh</button></div>
          </header>
          <section class="stats-grid moderation-stats">
            <div class="stat-card"><span>Pending messages</span><strong>${counts.pending}</strong></div>
            <div class="stat-card"><span>Approved messages</span><strong>${counts.approved}</strong></div>
            <div class="stat-card"><span>Pending comments</span><strong>${counts.pendingComments}</strong></div>
            <div class="stat-card"><span>Pinned messages</span><strong>${counts.pinned}</strong></div>
          </section>
          <div class="share-panel">
            <div><p class="eyebrow">Anonymous message link</p><a class="share-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noreferrer">${escapeHtml(linkUrl)}</a></div>
            <div class="action-row"><button class="secondary-button" data-action="copy-link">Copy link</button><button class="secondary-button" data-action="open-link">Open link</button><button class="secondary-button" data-action="show-qr">QR code</button></div>
          </div>
          <nav class="dashboard-tabs" aria-label="Moderation sections">
            ${sections.map(([key, label]) => `<button type="button" class="dashboard-tab ${state.dashboardSection === key ? 'active' : ''}" data-section="${key}" aria-current="${state.dashboardSection === key ? 'page' : 'false'}">${label}</button>`).join('')}
          </nav>
          <div class="notice" data-notice aria-live="polite">${escapeHtml(noticeMessage)}</div>
          ${!state.dashboardSection ? '<div class="empty-state">No tabs open. Select or add a tab to view.</div>' : (state.dashboardSection === 'comments' ? commentsPanel : `
            <div class="inbox-header"><h2>${sections.find(([key]) => key === state.dashboardSection)?.[1] || 'Inbox'}</h2><span class="count-pill">${visibleMessages.length}</span></div>
            <div class="message-list">
              ${visibleMessages.length ? visibleMessages.map((message) => {
                const relatedComments = state.comments.filter((comment) => comment.message_id === message.id);
                
                let expiresText = '';
                if (message.status === 'approved' && message.approved_expires_at) {
                  const diff = new Date(message.approved_expires_at).getTime() - Date.now();
                  if (diff > 0) {
                    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
                    expiresText = `<span class="expiration-badge" aria-label="Message expires in ${d} days and ${h} hours">Expires in ${d}d ${h}h</span>`;
                  } else {
                    expiresText = `<span class="status status-rejected">Expired</span>`;
                  }
                }

                return `<article class="message-card" data-id="${message.id}" data-admin-open="${message.id}" tabindex="0" role="button" aria-label="Open message details">
                  <div class="message-topline">
                    <span class="status status-${message.status}">${message.status}${message.is_pinned ? ' · pinned' : ''}</span>
                    ${expiresText}
                    <time>${escapeHtml(formatRelativeTime(message.created_at))}</time>
                  </div>
                  <p>${escapeHtml(message.message || 'Message with image attachment')}</p>
                  <div class="message-card-meta"><span>${relatedComments.length} response${relatedComments.length === 1 ? '' : 's'}</span>${message.media_path ? '<span>Attachment</span>' : ''}${message.is_read ? '' : '<span>Unread</span>'}</div>
                </article>`;
              }).join('') : '<div class="empty-state">No messages in this section.</div>'}
            </div>
          `)}
        </section>
      </main>
    `;

    document.querySelectorAll('[data-media-preview]').forEach(async (node) => {
      const message = state.messages.find((item) => item.id === node.dataset.mediaPreview);
      if (!message?.media_path) return;
      try {
        const { data, error } = await supabase.storage.from('message-media').createSignedUrl(message.media_path, 3600);
        if (error || !data?.signedUrl) throw error || new Error('No signed URL');
        node.innerHTML = message.media_type?.startsWith('video/')
          ? `<video controls src="${escapeHtml(data.signedUrl)}" preload="metadata"></video>`
          : `<img src="${escapeHtml(data.signedUrl)}" alt="Anonymous message media" />`;
      } catch {
        node.innerHTML = '<span class="media-fallback">Media unavailable</span>';
      }
    });
    subscribeToMessageNotifications(adminId);
  } catch (error) {
    if (!isCurrentDashboardLoad()) return;
    root.innerHTML = `<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Dashboard unavailable</p><h1>Moderation data could not be loaded.</h1><p class="subcopy">${escapeHtml(error.message || 'Check the database migration and RLS policies.')}</p></div></main>`;
  }
}

async function fetchProfileByUsername(username) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_public_profile', { p_username: username });

  if (error) throw error;

  return data?.[0] || null;
}

async function renderPublicConfessions(noticeMessage = '') {
  await renderReactPage('PublicPage', {
    inboxUrl: `/message/${INBOX_USERNAME}`,
    fetchPage: fetchPublicPage,
    formatRelativeTime,
    onOpenMessage: (messageId) => openMessageDetail(messageId, 'public'),
    noticeMessage,
  });
}

async function fetchPublicPage(offset = 0) {
  const { data, error } = await supabase.rpc('get_public_confessions', {
    p_limit: 20,
    p_offset: offset,
  });
  if (error) throw error;

  return Promise.all((data || []).map(async (message) => {
    if (!message.media_path || message.media_type?.startsWith('video/')) return message;
    try {
      const { data: mediaData, error: mediaError } = await supabase.storage
        .from('message-media')
        .createSignedUrl(message.media_path, 3600);
      if (mediaError || !mediaData?.signedUrl) return { ...message, media_path: null };
      return { ...message, media_url: mediaData.signedUrl };
    } catch {
      return { ...message, media_path: null };
    }
  }));
}

async function loadPublicComments(messageId) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_public_comments', { p_message_id: messageId });
  if (error) throw error;
  return data || [];
}

async function openMessageDetail(messageId, mode = 'public') {
  state.modalReturnFocus = document.activeElement;
  state.modalScrollPosition = window.scrollY;
  let message;
  let comments = [];
  try {
    if (mode === 'admin') {
      message = state.messages.find((item) => item.id === messageId);
      comments = state.comments.filter((comment) => comment.message_id === messageId);
      if (!message) throw new Error('Message is unavailable.');
    } else {
      const [{ data, error }, approvedComments] = await Promise.all([
        supabase.rpc('get_public_message', { p_message_id: messageId }),
        loadPublicComments(messageId),
      ]);
      if (error) throw error;
      message = data?.[0];
      comments = approvedComments;
      if (!message) throw new Error('This confession is no longer available.');
    }
    const messageMediaExpired = isMediaExpired(message);
    const initialPublicVersion = String(message.public_message || '').trim() || String(message.message || '');
    const hasInitialPublicVersion = Boolean(initialPublicVersion.trim());
    const modal = document.createElement('div');
    modal.className = 'detail-modal-backdrop';
    modal.dataset.modalMode = mode;
    modal.innerHTML = `
      <section class="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
        <header class="detail-modal-header"><h2 id="detail-title">${mode === 'admin' ? 'Message details' : 'Anonymous confession'}</h2><button type="button" class="icon-button" data-action="close-modal" aria-label="Close message details">&times;</button></header>
        <div class="detail-modal-grid">
          <section class="detail-main">
            ${mode === 'admin' ? `<div class="message-admin-meta"><span class="status status-${message.status}">${escapeHtml(message.status)}</span><span>${message.is_pinned ? 'Pinned' : 'Not pinned'}</span><time>${escapeHtml(new Date(message.created_at).toLocaleString())}</time><span>${message.approved_expires_at ? `Expires ${escapeHtml(new Date(message.approved_expires_at).toLocaleString())}` : 'Not published'}</span></div>` : `<div class="message-admin-meta"><time>${escapeHtml(new Date(message.created_at).toLocaleDateString())}</time>${message.is_pinned ? '<span class="pinned-label">Pinned</span>' : ''}</div>`}
            ${mode === 'admin' ? `<label class="field-label" for="original-message">Original message</label><textarea id="original-message" class="original-message" readonly>${escapeHtml(message.message || '')}</textarea>
              <label class="field-label" for="public-version">Public version</label><textarea id="public-version" class="public-version-editor" maxlength="4000">${escapeHtml(initialPublicVersion)}</textarea>
              <div class="censor-controls"><button type="button" class="secondary-button" data-action="censor-selected" data-replacement="******">Censor Selected</button><button type="button" class="secondary-button" data-action="censor-selected" data-replacement="[censored]">[censored]</button><input type="text" id="custom-censor" aria-label="Custom censor replacement" placeholder="Replacement" /><button type="button" class="secondary-button" data-action="censor-custom">Apply to selection</button><textarea id="censor-phrases" rows="2" aria-label="Words or phrases to censor" placeholder="Words or phrases, one per line"></textarea><button type="button" class="secondary-button" data-action="censor-phrases">Censor matching phrases</button></div>
              <button type="button" class="secondary-button" data-action="preview-public-version">Preview Public Version</button>
              <div class="public-preview" data-public-preview hidden></div>` : `<p class="detail-message-text">${escapeHtml(message.public_message || '')}</p>`}
            ${messageMediaExpired ? '<p class="media-fallback">Media expired</p>' : ''}
            ${message.media_path && !messageMediaExpired ? `<div class="detail-media" data-detail-media="${escapeHtml(message.media_path)}" data-media-type="${escapeHtml(message.media_type || '')}"></div>` : ''}
            ${mode === 'admin' ? `<div class="message-actions modal-actions">${message.status === 'approved' && message.public_message?.trim() ? `<button data-action="download-image" data-id="${message.id}">Download share image</button>` : ''}${message.media_path && !messageMediaExpired ? `<button data-action="download-media" data-id="${message.id}">Download attachment</button>` : ''}<button data-action="save-public-version" data-id="${message.id}" ${hasInitialPublicVersion ? '' : 'disabled'}>Save Public Version</button><button data-action="moderate-message" data-id="${message.id}" data-status="approved" ${hasInitialPublicVersion ? '' : 'disabled'}>Approve</button><button data-action="moderate-message" data-id="${message.id}" data-status="rejected">Reject</button><button data-action="toggle-pin" data-id="${message.id}">${message.is_pinned ? 'Unpin' : 'Pin'}</button><button data-action="toggle-public-status" data-id="${message.id}" ${message.status === 'approved' || hasInitialPublicVersion ? '' : 'disabled'}>${message.status === 'approved' ? 'Remove from Public' : 'Make Public'}</button><button class="danger-action" data-action="delete-message" data-id="${message.id}">Delete</button></div>` : ''}
          </section>
          <aside class="detail-comments"><h3>Comments <span>(${comments.length})</span></h3><div class="detail-comment-scroll" data-comment-list>
            ${comments.length ? comments.map((comment) => `<article class="public-comment"><div class="comment-meta">${mode === 'admin' ? `<span class="status status-${comment.status}">${comment.status}</span>` : '<span>Anonymous</span>'}<time>${escapeHtml(formatRelativeTime(comment.created_at))}</time></div><p>${escapeHtml(mode === 'admin' ? comment.comment_text || 'Response with media attachment' : comment.comment_text || 'Response with media attachment')}</p>${isMediaExpired(comment) ? '<p class="media-fallback">Media expired</p>' : comment.media_path ? `<div data-detail-media="${escapeHtml(comment.media_path)}" data-media-type="${escapeHtml(comment.media_type || '')}"></div>` : ''}${mode === 'admin' ? `<div class="message-actions">${comment.media_path && !isMediaExpired(comment) ? `<button data-action="download-comment-media" data-id="${comment.id}" data-path="${escapeHtml(comment.media_path)}">Download attachment</button>` : ''}<button data-action="moderate-comment" data-id="${comment.id}" data-status="approved">Approve</button><button data-action="moderate-comment" data-id="${comment.id}" data-status="rejected">Reject</button><button class="danger-action" data-action="delete-comment" data-id="${comment.id}">Delete</button></div>` : ''}</article>`).join('') : '<p class="context-copy">No approved responses yet.</p>'}
          </div>${mode === 'public' ? `<form class="comment-form" data-comment-form="${messageId}"><label class="sr-only" for="comment-${messageId}">Write an anonymous response</label><textarea id="comment-${messageId}" name="comment" maxlength="4000" placeholder="Write an anonymous response..."></textarea>${mediaUploadControl(`comment-media-${messageId}`, 'media', 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm')}<div class="notice" data-comment-notice aria-live="polite"></div><button type="submit" class="primary-button">Submit Comment</button></form>` : ''}</aside>
        </div>
      </section>`;
    root.appendChild(modal);
    document.body.classList.add('modal-open');
    if (mode === 'admin') {
      const editor = modal.querySelector('#public-version');
      const saveButton = modal.querySelector('[data-action="save-public-version"]');
      const approveButton = modal.querySelector('[data-action="moderate-message"][data-status="approved"]');
      const publishButton = modal.querySelector('[data-action="toggle-public-status"]');
      const updatePublishActions = () => {
        const hasPublicVersion = Boolean(editor?.value.trim());
        if (saveButton) saveButton.disabled = !hasPublicVersion;
        if (approveButton) approveButton.disabled = !hasPublicVersion;
        if (publishButton && message.status !== 'approved') publishButton.disabled = !hasPublicVersion;
      };
      editor?.addEventListener('input', updatePublishActions);
      updatePublishActions();
    }
    modal.querySelector('[data-action="close-modal"]').focus();
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeMessageDetail();
    });
    for (const media of modal.querySelectorAll('[data-detail-media]')) {
      const { data, error } = await supabase.storage.from('message-media').createSignedUrl(media.dataset.detailMedia, 300);
      if (error || !data?.signedUrl) {
        media.textContent = 'Media expired';
      } else if (media.dataset.mediaType.startsWith('video/')) {
        media.innerHTML = `<video controls preload="none" playsinline src="${escapeHtml(data.signedUrl)}"></video>`;
      } else {
        media.innerHTML = `<button type="button" class="media-image-button" data-action="open-media-viewer"><img loading="lazy" src="${escapeHtml(data.signedUrl)}" alt="Message attachment" /></button>`;
      }
    }
  } catch (error) {
    setNotice(error.message || 'Message details could not be loaded.', 'error');
  }
}

function closeMessageDetail() {
  const modal = document.querySelector('.detail-modal-backdrop');
  if (!modal) return;
  modal.remove();
  document.body.classList.remove('modal-open');
  window.scrollTo(0, state.modalScrollPosition);
  state.modalReturnFocus?.focus?.();
}

async function renderPublicMessage(username) {
  const safeUsername = decodeURIComponent(username || '').trim();

  try {
    const profile = await fetchProfileByUsername(safeUsername);
    if (!profile) {
      root.innerHTML = `
        <main class="page-shell config-shell">
          <div class="config-card">
            <p class="eyebrow">Link not found</p>
            <h1>This inbox is not available.</h1>
            <a href="/" class="primary-button">Return home</a>
          </div>
        </main>
      `;
      return;
    }

    let selectedFile = null;
    const maxMb = getMaxUploadSizeMb();

    root.innerHTML = `
      <main class="page-shell public-shell">
        ${publicNavbar()}
        <section class="message-panel">
          <p class="eyebrow">Send an anonymous message</p>
          <h1>Send me an anonymous message</h1>
              <p class="subcopy">Your identity isn't shown to the recipient.</p>

          <div class="page-description">
            <h3>📝 What is this?</h3>
            <p>CETP Confessions is a safe, anonymous space for our campus community. Share a hidden crush, a funny classroom moment, a heartfelt thank-you, or anything on your mind — without revealing who you are.</p>
            <div class="description-details">
              <div class="detail-item"><span>🔒</span><p><strong>Anonymous to the recipient</strong> — your identity isn't shown to the recipient.</p></div>
              <div class="detail-item"><span>🛡️</span><p><strong>Moderated for safety</strong> — every message is reviewed by admins before it goes public.</p></div>
              <div class="detail-item"><span>📎</span><p><strong>Attach media</strong> — add a photo, GIF, or short video (max ${maxMb} MB).</p></div>
            </div>
          </div>

          <form id="message-form" class="stack-form">
            <textarea name="message" maxlength="4000" placeholder="Write your message..." required autocomplete="off"></textarea>
            ${mediaUploadControl('media-input', 'media', 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm', `JPG, PNG, GIF, MP4 or WebM · Max ${maxMb} MB`)}
            <div id="file-preview" class="file-preview"></div>
            <div class="notice" data-notice aria-live="polite"></div>
            <div class="react-gradient-btn-mount" data-label="Send anonymously" data-type="submit" style="width:100%"></div>
          </form>
        </section>
      </main>
    `;

    const fileInput = document.querySelector('#media-input');
    const filePreview = document.querySelector('#file-preview');

    fileInput.addEventListener('change', () => {
      const inputFile = fileInput.files?.[0] || null;
      selectedFile = inputFile;
      if (!inputFile) {
        filePreview.innerHTML = '';
        return;
      }

      try { validateMediaFile(inputFile); } catch (error) {
        selectedFile = null;
        fileInput.value = '';
        setNotice(error.message, 'error');
        return;
      }
      const previewUrl = URL.createObjectURL(inputFile);
      filePreview.innerHTML = inputFile.type.startsWith('video/')
        ? `<video controls preload="metadata" src="${previewUrl}"></video>`
        : `<img src="${previewUrl}" alt="Selected upload preview" />`;
    });

    document.querySelector('#message-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const messageText = form.message.value.trim();

      try {
        if (!messageText) {
          throw new Error('Write a message before sending.');
        }

        const now = Date.now();
        if (now - state.lastSubmissionAt < 15000) {
          throw new Error('Please wait a moment before sending another anonymous message.');
        }

        let mediaPath = null;
        let mediaType = null;

        if (selectedFile) {
          validateMediaFile(selectedFile);
          const extension = selectedFile.name.split('.').pop() || 'png';
          const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
          const path = `${profile.username}/${filename}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('message-media')
            .upload(path, selectedFile, {
              contentType: selectedFile.type,
              cacheControl: '3600',
              upsert: false,
            });

          if (uploadError) throw uploadError;
          mediaPath = uploadData.path;
          mediaType = selectedFile.type;
        }

        try {
          const { data, error } = await supabase.rpc('insert_anonymous_message', {
            p_username: profile.username,
            p_message: messageText,
            p_media_path: mediaPath,
            p_media_type: mediaType,
          });
          if (error) throw error;
        } catch (rpcError) {
          if (mediaPath) {
            await supabase.storage.from('message-media').remove([mediaPath]);
          }
          throw rpcError;
        }

        state.lastSubmissionAt = Date.now();
        localStorage.setItem('cetp-last-submit', String(state.lastSubmissionAt));

        root.innerHTML = `
          <main class="page-shell success-shell">
            <div class="config-card">
              <p class="eyebrow">Success</p>
              <h1>✓ Message Sent</h1>
              <p class="subcopy">Your anonymous message has been sent successfully.</p>
              <div class="hero-actions"><a href="/message/${encodeURIComponent(profile.username)}" class="primary-button">Send Another Message</a><a href="/" class="secondary-button">Back to Home</a></div>
            </div>
          </main>
        `;
      } catch (error) {
        setNotice('Unable to send your message. ' + (error.message || 'Please try again.'), 'error');
          const retry = document.querySelector('[data-action="retry-message"]');
          if (!retry) document.querySelector('#message-form')?.insertAdjacentHTML('beforeend', '<button type="submit" class="secondary-button" data-action="retry-message">Try Again</button>');
      }
    });
  } catch (error) {
    root.innerHTML = `
      <main class="page-shell config-shell">
        <div class="config-card">
          <p class="eyebrow">Inbox unavailable</p>
          <h1>We could not open this message page.</h1>
          <a href="/" class="primary-button">Back home</a>
        </div>
      </main>
    `;
  }
}

async function handleLogin(data) {
  const email = String(data.email || '').trim();
  const password = String(data.password || '');

  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const response = await fetch('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const responseIsJson = response.headers.get('content-type')?.includes('application/json');
  const loginData = responseIsJson ? await response.json().catch(() => ({})) : {};
  if (!responseIsJson) {
    throw new Error(response.status === 404 || response.ok
      ? 'Vercel did not run /api/admin-login. Confirm api/admin-login.js is deployed from the project root and check Vercel routing.'
      : `The Vercel sign-in endpoint returned HTTP ${response.status}. Check its Function logs.`);
  }
  if (!response.ok) {
    const authError = new Error(loginData.message || `The Vercel sign-in endpoint returned HTTP ${response.status}.`);
    authError.retryAfterSeconds = Number(loginData.retryAfterSeconds) || 0;
    authError.attemptsRemaining = Number.isFinite(loginData.attemptsRemaining)
      ? Number(loginData.attemptsRemaining)
      : null;
    throw authError;
  }

  const session = loginData?.session;
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error('Sign-in completed without an active session. Please try again.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession(session);
  if (sessionError) throw sessionError;
  state.user = sessionData?.session?.user ?? null;
  if (!state.user) throw new Error('The admin session could not be restored. Please try again.');
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.target instanceof HTMLFormElement ? event.target : event.currentTarget?.querySelector?.('#auth-form');

  if (!(form instanceof HTMLFormElement)) {
    setNotice('The form could not be submitted.', 'error');
    return;
  }

  if (form.dataset.authSubmitting === 'true') return;
  const lockedUntil = Number(form.dataset.authLockoutUntil) || 0;
  if (lockedUntil > Date.now()) {
    startAuthLockout(form, Math.ceil((lockedUntil - Date.now()) / 1000));
    return;
  }

  const data = Object.fromEntries(new FormData(form));
  form.dataset.authSubmitting = 'true';
  syncAuthSubmitButton(form);
  try {
    setNotice('Signing in…');
    await handleLogin(data);
    delete form.dataset.authSubmitting;
    window.history.replaceState(null, '', '/admin/dashboard');
    await route();
  } catch (error) {
    delete form.dataset.authSubmitting;
    const retryAfterSeconds = Number(error.retryAfterSeconds) || 0;
    if (retryAfterSeconds > 0) {
      startAuthLockout(form, retryAfterSeconds);
      return;
    }
    const attemptsRemaining = error.attemptsRemaining;
    const remainingNotice = Number.isFinite(attemptsRemaining)
      ? ` ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining before a temporary lock.`
      : '';
    setNotice(`${error.message || 'Sign-in failed.'}${remainingNotice}`, 'error');
    syncAuthSubmitButton(form);
  }
}

async function handleDeleteMessage(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;

  const confirmed = window.confirm('Delete this anonymous message?');
  if (!confirmed) return;

  const relatedComments = state.comments.filter((comment) => comment.message_id === id);
  const mediaPaths = [message.media_path, ...relatedComments.map((comment) => comment.media_path)].filter(Boolean);
  if (mediaPaths.length) {
    const { error: mediaError } = await supabase.storage.from('message-media').remove(mediaPaths);
    if (mediaError) {
      setNotice('Message media could not be deleted. The message was kept.', 'error');
      return;
    }
  }

  const { error } = await supabase.from('messages').delete().eq('id', id).eq('admin_id', state.user.id);
  if (error) {
    setNotice('Message could not be deleted.', 'error');
    return;
  }

  closeMessageDetail();
  await renderDashboard();
}

async function moderateMessage(id, status) {
  const update = { status };
  if (status === 'approved') {
    const editor = document.querySelector('#public-version');
    const message = state.messages.find((item) => item.id === id);
    const publicMessage = editor ? editor.value.trim() : message?.public_message?.trim();
    if (!publicMessage) throw new Error('Add and save a public version before approving.');
    update.public_message = publicMessage;
    update.public_edited_at = new Date().toISOString();
    update.public_edited_by = state.user.id;
  }
  const { error } = await supabase.from('messages').update(update).eq('id', id).eq('admin_id', state.user.id);
  if (error) throw error;
  const messages = { approved: 'Message approved and published.', pending: 'Message removed from public view.', rejected: 'Message rejected.' };
  closeMessageDetail();
  await renderDashboard(messages[status] || 'Message updated.');
}

async function toggleMessagePin(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;
  const { error } = await supabase.from('messages').update({ is_pinned: !message.is_pinned }).eq('id', id).eq('admin_id', state.user.id);
  if (error) throw error;
  closeMessageDetail();
  await renderDashboard(message.is_pinned ? 'Message unpinned.' : 'Message pinned. Pinning does not publish a message.');
}

async function moderateComment(id, status) {
  // Find the message this comment belongs to
  const comment = state.comments.find(c => c.id === id);
  if (!comment) return;
  const message = state.messages.find(m => m.id === comment.message_id && m.admin_id === state.user.id);
  if (!message) throw new Error('Unauthorized');

  const { error } = await supabase.from('message_comments').update({ status }).eq('id', id);
  if (error) throw error;
  const messages = { approved: 'Comment approved and published.', pending: 'Comment removed from public view.', rejected: 'Comment rejected.' };
  closeMessageDetail();
  await renderDashboard(messages[status] || 'Comment updated.');
}

async function deleteComment(id) {
  if (!window.confirm('Delete this anonymous response?')) return;
  
  // Find the message this comment belongs to for defense in depth
  const comment = state.comments.find(c => c.id === id);
  if (!comment) return;
  const message = state.messages.find(m => m.id === comment.message_id && m.admin_id === state.user.id);
  if (!message) {
    setNotice('Unauthorized', 'error');
    return;
  }

  if (comment.media_path) {
    const { error: mediaError } = await supabase.storage.from('message-media').remove([comment.media_path]);
    if (mediaError) throw mediaError;
  }
  const { error } = await supabase.from('message_comments').delete().eq('id', id);
  if (error) throw error;
  closeMessageDetail();
  await renderDashboard('Comment deleted.');
}

async function handleToggleRead(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;

  const { error } = await supabase
    .from('messages')
    .update({ is_read: !message.is_read })
    .eq('id', id)
    .eq('admin_id', state.user.id);

  if (error) {
    setNotice('The status update failed.', 'error');
    return;
  }

  await renderDashboard();
}

async function downloadSignedMedia(path, filename) {
  try {
    const { data, error } = await supabase.storage.from('message-media').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw error || new Error('Could not create download link.');

    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error('Download failed.');
    const blob = await response.blob();

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } catch {
    setNotice('The attachment could not be downloaded.', 'error');
  }
}

async function handleDownloadMedia(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message?.media_path) {
    setNotice('This message has no media attachment.', 'error');
    return;
  }
  const extension = message.media_path.split('.').pop() || 'bin';
  await downloadSignedMedia(message.media_path, `attachment-${id}.${extension}`);
}

async function handleDownloadCommentMedia(id, path) {
  if (!path || !state.comments.some((comment) => comment.id === id && comment.media_path === path)) {
    setNotice('This comment has no downloadable attachment.', 'error');
    return;
  }
  const extension = path.split('.').pop() || 'bin';
  await downloadSignedMedia(path, `comment-attachment-${id}.${extension}`);
}

async function handleDownloadShareImage(id) {
  const message = state.messages.find((item) => item.id === id);
  const publicText = String(message?.public_message || '').trim();
  if (!message || message.status !== 'approved' || !publicText) {
    setNotice('Only approved messages with a public version can be shared.', 'error');
    return;
  }

  const logoImg = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/logo.jpg';
  });

  const canvas = document.createElement('canvas');
  canvas.width = 1072;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    setNotice('The share image could not be created.', 'error');
    return;
  }

  const cardX = 183.5;
  const cardY = 183.5;
  const cardW = 704.8;
  const cardR = 38.4;
  const sidePadding = 64;
  const maxWidth = cardW - sidePadding * 2;
  const baseCardHeight = 704.8;
  const textStartOffset = 240;
  const footerGap = 120;
  const footerOffset = 80;
  const words = publicText.replace(/\s+/g, ' ').split(' ');

  function wrapText(fontSize) {
    ctx.font = `500 ${fontSize}px "DM Sans", sans-serif`;
    const wrapped = [];
    let line = '';

    for (const word of words) {
      if (ctx.measureText(word).width > maxWidth) {
        if (line) wrapped.push(line);
        line = '';
        let segment = '';
        for (const character of Array.from(word)) {
          const candidate = segment + character;
          if (segment && ctx.measureText(candidate).width > maxWidth) {
            wrapped.push(segment);
            segment = character;
          } else {
            segment = candidate;
          }
        }
        line = segment;
        continue;
      }

      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        wrapped.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) wrapped.push(line);
    return wrapped;
  }

  const maxFontSize = 34 * (96 / 72);
  const minFontSize = 18;
  let fontSize = maxFontSize;
  let lines = [];
  let lineHeight = 0;
  while (true) {
    lines = wrapText(fontSize);
    lineHeight = Math.round(fontSize * 1.38);
    const textHeight = (lines.length - 1) * lineHeight + fontSize;
    if (textHeight <= baseCardHeight - textStartOffset - footerGap || fontSize <= minFontSize) break;
    fontSize = Math.max(minFontSize, fontSize - 2);
  }

  const textHeight = (lines.length - 1) * lineHeight + fontSize;
  const cardH = Math.max(baseCardHeight, textStartOffset + textHeight + footerGap);
  canvas.height = Math.ceil(cardY * 2 + cardH);

  ctx.fillStyle = '#7b6faf';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cardX + cardR, cardY);
  ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + cardH, cardR);
  ctx.arcTo(cardX + cardW, cardY + cardH, cardX, cardY + cardH, cardR);
  ctx.arcTo(cardX, cardY + cardH, cardX, cardY, cardR);
  ctx.arcTo(cardX, cardY, cardX + cardW, cardY, cardR);
  ctx.closePath();
  ctx.fill();

  const logoSize = 88;
  const logoX = cardX + sidePadding;
  const logoY = cardY + 64;
  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
    ctx.restore();
  } else {
    ctx.fillStyle = '#36336f';
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 30px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('C', logoX + logoSize / 2, logoY + logoSize / 2 + 13);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 34px "DM Sans", sans-serif';
  ctx.fillText('Cetp Confessions', logoX + logoSize + 19, logoY + 42);
  ctx.fillStyle = '#64748b';
  ctx.font = '400 24px "DM Sans", sans-serif';
  ctx.fillText('@confession.cetp', logoX + logoSize + 19, logoY + 77);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + sidePadding, cardY + 176);
  ctx.lineTo(cardX + cardW - sidePadding, cardY + 176);
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = `500 ${fontSize}px "DM Sans", sans-serif`;
  const textStartY = cardY + textStartOffset;
  lines.forEach((line, index) => {
    ctx.fillText(line, cardX + sidePadding, textStartY + index * lineHeight);
  });

  ctx.beginPath();
  ctx.moveTo(cardX + sidePadding, cardY + cardH - footerOffset);
  ctx.lineTo(cardX + cardW - sidePadding, cardY + cardH - footerOffset);
  ctx.stroke();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    setNotice('The share image could not be created.', 'error');
    return;
  }

  const link = document.createElement('a');
  link.download = `confession-${id}.png`;
  link.href = URL.createObjectURL(blob);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}


async function handleLogout() {
  if (!supabase) return;
  dashboardLoadSequence += 1;
  stopMessageNotifications();
  state.user = null;
  state.profile = null;
  window.history.replaceState(null, '', '/admin/login');
  renderAuth('login');
  const { error } = await supabase.auth.signOut();
  if (error) setNotice('Could not clear the server session. Please try again.', 'error');
}

async function route() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== '/admin/dashboard') stopMessageNotifications();
  if (pathname !== '/' && pathname !== '/public') unmountReactPage();

  if (!supabaseConfig.isReady) {
    renderLegacyMarkup(`
      <main class="page-shell config-shell">
        <div class="config-card">
          <p class="eyebrow">Setup required</p>
          <h1>Connect Supabase.</h1>
          <p class="subcopy">Add your Vite Supabase URL and anon key to the environment variables before using the app.</p>
        </div>
      </main>
    `);
    return;
  }

  if (pathname === '/admin/login') {
    const authMode = new URLSearchParams(window.location.search).get('mode');
    if (authMode === 'forgot') {
      renderAuth('forgot');
      return;
    }
    if (authMode === 'reset') {
      renderAuth('reset');
      return;
    }
    if (state.user) {
      window.history.replaceState(null, '', '/admin/dashboard');
      await renderDashboard();
      return;
    }
    renderAuth('login');
    return;
  }

  if (pathname === '/admin/register' || pathname === '/register') {
    window.location.replace('/admin/login');
    return;
  }

  if (pathname === '/admin/dashboard') {
    if (!state.user) {
      window.location.replace('/admin/login');
      return;
    }
    await renderDashboard();
    return;
  }

  if (pathname === '/public') {
    await renderPublicConfessions();
    return;
  }

  const match = pathname.match(/^\/message\/(.+)$/);
  if (match) {
    const username = decodeURIComponent(match[1]);
    await renderPublicMessage(username);
    return;
  }

  if (pathname === '/') {
    await renderHome();
    return;
  }

  renderLegacyMarkup('<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Page not found</p><h1>This page does not exist.</h1><a href="/" class="primary-button">Return home</a></div></main>');
}

root.addEventListener('submit', async (event) => {
  if (event.target.matches('#auth-form')) {
    await handleAuthSubmit(event);
    return;
  }
  if (event.target.matches('#forgot-password-form')) {
    await handleForgotPassword(event);
    return;
  }
  if (event.target.matches('#reset-password-form')) {
    await handlePasswordUpdate(event);
    return;
  }
  if (event.target.matches('#auth-mfa-form')) {
    await handleMfaSubmit(event);
    return;
  }

  const commentForm = event.target.closest('[data-comment-form]');
  if (commentForm) {
    event.preventDefault();
    const messageId = commentForm.dataset.commentForm;
    const formData = new FormData(commentForm);
    const commentText = formData.get('comment')?.toString().trim() || '';
    const mediaFile = formData.get('media');
    const notice = commentForm.querySelector('[data-comment-notice]');
    if (!commentText && (!(mediaFile instanceof File) || !mediaFile.size)) {
      notice.textContent = 'Write a response or attach media before sending.';
      notice.dataset.kind = 'error';
      return;
    }
    if (mediaFile instanceof File && mediaFile.size) {
      try { validateMediaFile(mediaFile); } catch (error) {
        notice.textContent = error.message;
        notice.dataset.kind = 'error';
        return;
      }
    }

    const submitButton = commentForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    notice.textContent = 'Sending for admin review…';
    let mediaPath = null;
    try {
      if (mediaFile instanceof File && mediaFile.size) {
        const extension = mediaFile.name.split('.').pop() || 'bin';
        const uploadPath = `${messageId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { data, error } = await supabase.storage.from('message-media').upload(uploadPath, mediaFile, {
          contentType: mediaFile.type,
          cacheControl: '3600',
          upsert: false,
        });
        if (error) throw error;
        mediaPath = data.path;
      }
      const { error } = await supabase.rpc('submit_anonymous_comment', {
        p_message_id: messageId,
        p_comment_text: commentText,
        p_media_path: mediaPath,
        p_media_type: mediaFile instanceof File && mediaFile.size ? mediaFile.type : null,
      });
      if (error) throw error;
      notice.textContent = 'Your response was sent for review.';
      notice.dataset.kind = 'success';
      commentForm.reset();
    } catch (error) {
      if (mediaPath) await supabase.storage.from('message-media').remove([mediaPath]);
      notice.textContent = 'Your response could not be sent. Please try again.';
      notice.dataset.kind = 'error';
      submitButton.disabled = false;
    }
  }
});

root.addEventListener('change', async (event) => {
  if (event.target.matches('[data-action="add-tab"]')) {
    const tab = event.target.value;
    if (tab && !state.openTabs.includes(tab)) {
      state.openTabs.push(tab);
      state.dashboardSection = tab;
      await renderDashboard();
    }
  }
});

root.addEventListener('click', async (event) => {
  const sectionTarget = event.target.closest('[data-section]');
  if (sectionTarget) {
    state.dashboardSection = sectionTarget.dataset.section;
    await renderDashboard();
    return;
  }

  const commentStatusTarget = event.target.closest('[data-comment-status]');
  if (commentStatusTarget) {
    state.commentStatus = commentStatusTarget.dataset.commentStatus;
    await renderDashboard();
    return;
  }

  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) {
    const adminCard = event.target.closest('[data-admin-open]');
    if (adminCard) await openMessageDetail(adminCard.dataset.adminOpen, 'admin');
    return;
  }

  const action = actionTarget.dataset.action;

  try {
    switch (action) {
    case 'toggle-nav': {
      const nav = actionTarget.closest('.public-nav');
      const open = actionTarget.getAttribute('aria-expanded') !== 'true';
      if (nav) setMobileNavOpen(nav, open);
      break;
    }
    case 'close-modal':
      closeMessageDetail();
      break;
    case 'save-public-version': {
      const id = actionTarget.dataset.id;
      const publicMessage = document.querySelector('#public-version')?.value.trim();
      if (!publicMessage) throw new Error('The public version cannot be empty.');
      const { error } = await supabase.from('messages').update({
        public_message: publicMessage,
        public_edited_at: new Date().toISOString(),
        public_edited_by: state.user.id,
      }).eq('id', id).eq('admin_id', state.user.id);
      if (error) throw error;
      setNotice('Public version saved.', 'success');
      closeMessageDetail();
      await renderDashboard('Public version saved.');
      break;
    }
    case 'preview-public-version': {
      const editor = document.querySelector('#public-version');
      const preview = document.querySelector('[data-public-preview]');
      if (!editor || !preview) break;
      preview.textContent = editor.value;
      preview.hidden = !preview.hidden;
      break;
    }
    case 'censor-selected':
    case 'censor-custom': {
      const editor = document.querySelector('#public-version');
      if (!editor || editor.selectionStart === editor.selectionEnd) throw new Error('Select text in the public version first.');
      const replacement = action === 'censor-selected' ? actionTarget.dataset.replacement : document.querySelector('#custom-censor')?.value;
      if (!replacement) throw new Error('Enter a replacement first.');
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText(replacement, start, end, 'select');
      editor.focus();
      break;
    }
    case 'censor-phrases': {
      const editor = document.querySelector('#public-version');
      const phrases = document.querySelector('#censor-phrases')?.value.split('\n').map((item) => item.trim()).filter(Boolean) || [];
      const replacement = document.querySelector('#custom-censor')?.value || '******';
      if (!editor || !phrases.length) throw new Error('Enter one or more words or phrases to censor.');
      const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let result = editor.value;
      for (const phrase of phrases) {
        const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
        result = result.replace(pattern, replacement);
      }
      editor.value = result;
      break;
    }
    case 'toggle-public-status': {
      const id = actionTarget.dataset.id;
      const message = state.messages.find((item) => item.id === id);
      await moderateMessage(id, message?.status === 'approved' ? 'pending' : 'approved');
      break;
    }
    case 'open-media-viewer': {
      const image = actionTarget.querySelector('img');
      if (!image) break;
      const viewer = document.createElement('div');
      viewer.className = 'media-viewer-backdrop';
      viewer.innerHTML = `<button type="button" class="icon-button" data-action="close-media-viewer" aria-label="Close image viewer">&times;</button><img src="${escapeHtml(image.src)}" alt="Enlarged message attachment" />`;
      document.body.appendChild(viewer);
      viewer.querySelector('button').focus();
      break;
    }
    case 'close-media-viewer':
      document.querySelector('.media-viewer-backdrop')?.remove();
      break;
    case 'close-tab': {
      const tab = actionTarget.dataset.tab;
      state.openTabs = state.openTabs.filter(t => t !== tab);
      if (state.dashboardSection === tab) {
        state.dashboardSection = state.openTabs[0] || '';
      }
      await renderDashboard();
      break;
    }
    case 'logout':
      await handleLogout();
      break;
    case 'copy-link': {
      const link = getPublicLink(state.profile?.username || '');
      await navigator.clipboard.writeText(link);
      setNotice('Anonymous link copied.', 'info');
      break;
    }
    case 'open-link': {
      const link = getPublicLink(state.profile?.username || '');
      window.open(link, '_blank', 'noopener,noreferrer');
      break;
    }
    case 'show-qr': {
      const link = getPublicLink(state.profile?.username || '');
      const dataUrl = await QRCode.toDataURL(link, { width: 220, margin: 1 });
      const dialog = document.createElement('dialog');
      dialog.innerHTML = `
        <form method="dialog" class="qr-dialog">
          <h2>Anonymous QR code</h2>
          <img src="${dataUrl}" alt="Anonymous link QR code" />
          <button type="submit" class="primary-button full-width">Close</button>
        </form>
      `;
      document.body.appendChild(dialog);
      dialog.showModal();
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      break;
    }
    case 'refresh-dashboard':
      await renderDashboard();
      break;
    case 'enable-notifications': {
      try {
        await enablePushNotifications();
        await renderDashboard('Notifications are set up. A test alert was sent to this device.');
      } catch (error) {
        await renderDashboard(error.message || 'Push notifications could not be enabled.');
      }
      break;
    }
    case 'delete-message':
      await handleDeleteMessage(actionTarget.dataset.id);
      break;
    case 'toggle-read':
      await handleToggleRead(actionTarget.dataset.id);
      break;
    case 'download-image':
      await handleDownloadShareImage(actionTarget.dataset.id);
      break;
    case 'download-media':
      await handleDownloadMedia(actionTarget.dataset.id);
      break;
    case 'download-comment-media':
      await handleDownloadCommentMedia(actionTarget.dataset.id, actionTarget.dataset.path);
      break;
    case 'moderate-message':
      await moderateMessage(actionTarget.dataset.id, actionTarget.dataset.status);
      break;
    case 'toggle-pin':
      await toggleMessagePin(actionTarget.dataset.id);
      break;
    case 'moderate-comment':
      await moderateComment(actionTarget.dataset.id, actionTarget.dataset.status);
      break;
    case 'delete-comment':
      await deleteComment(actionTarget.dataset.id);
      break;
    case 'toggle-comments': {
      const thread = document.querySelector(`[data-comments="${CSS.escape(actionTarget.dataset.id)}"]`);
      if (thread?.hidden) {
        await openPublicComments(actionTarget.dataset.id);
      } else if (thread) {
        thread.hidden = true;
        actionTarget.setAttribute('aria-expanded', 'false');
      }
      break;
    }
    case 'reply-comment':
      await openPublicComments(actionTarget.dataset.id, true);
      break;
    default:
      break;
    }
  } catch (error) {
    console.error(error);
    setNotice(error.message || 'The requested action failed.', 'error');
  }
});

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    state.user = session?.user ?? null;
    if (event === 'SIGNED_OUT') {
      dashboardLoadSequence += 1;
      stopMessageNotifications();
      state.profile = null;
      if (window.location.pathname === '/admin/dashboard') {
        window.history.replaceState(null, '', '/admin/login');
        renderAuth('login');
      }
    }
  });

  (async () => {
    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error) {
      renderAuth();
      setNotice(error.message || 'The saved session could not be loaded.', 'error');
      return;
    }
    state.user = sessionData?.session?.user ?? null;
    await route();
  })();
} else {
  route();
}

window.addEventListener('popstate', route);

document.addEventListener('click', (event) => {
  const viewer = document.querySelector('.media-viewer-backdrop');
  if (viewer && (event.target === viewer || event.target.closest('[data-action="close-media-viewer"]'))) {
    viewer.remove();
    return;
  }
  const link = event.target.closest('.public-nav a');
  if (!link) return;
  const nav = link.closest('.public-nav');
  if (nav?.classList.contains('menu-open')) setMobileNavOpen(nav, false);
});

document.addEventListener('keydown', (event) => {
  const viewer = document.querySelector('.media-viewer-backdrop');
  if (viewer && event.key === 'Escape') {
    viewer.remove();
    return;
  }
  const mobileNav = document.querySelector('.public-nav.menu-open');
  if (mobileNav && event.key === 'Escape') {
    event.preventDefault();
    setMobileNavOpen(mobileNav, false);
    return;
  }
  if (mobileNav && event.key === 'Tab') {
    const navFocusables = [...mobileNav.querySelectorAll('.menu-toggle, .nav-actions a')];
    const firstNavItem = navFocusables[0];
    const lastNavItem = navFocusables[navFocusables.length - 1];
    if (event.shiftKey && document.activeElement === firstNavItem) {
      event.preventDefault();
      lastNavItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastNavItem) {
      event.preventDefault();
      firstNavItem.focus();
    }
  }
  const modal = document.querySelector('.detail-modal-backdrop');
  if (!modal) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMessageDetail();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')]
    .filter((element) => !element.closest('[hidden]'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

document.addEventListener('keydown', async (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-admin-open]')) {
    event.preventDefault();
    await openMessageDetail(event.target.dataset.adminOpen, 'admin');
  }
});
