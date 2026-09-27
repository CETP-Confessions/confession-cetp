import './styles.css';
import QRCode from 'qrcode';
import { supabase, supabaseConfig } from './supabase.js';

const root = document.querySelector('#app');
const state = {
  user: null,
  profile: null,
  messages: [],
  lastSubmissionAt: Number(localStorage.getItem('quietdrop-last-submit') || 0),
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

function getPublicLink(username = '') {
  return `${window.location.origin}/message/${encodeURIComponent(username || state.profile?.username || '')}`;
}

function slugifyUsername(value = '') {
  const normalised = String(value)
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

  return normalised;
}

function validateUsername(value) {
  const username = slugifyUsername(value);
  if (!username || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(username)) {
    throw new Error('Use lowercase letters, numbers, and dashes only.');
  }
  return username;
}

function getMaxUploadSizeMb() {
  const size = Number(import.meta.env.VITE_MAX_IMAGE_MB || 5);
  return Number.isFinite(size) ? size : 5;
}

function validateMediaFile(file) {
  if (!file) return;
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only JPG, PNG, WebP, and GIF files are allowed.');
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

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function renderHome() {
  root.innerHTML = `
    <main class="page-shell home-shell">
      <nav class="top-nav">
        <a href="/" class="brand"><span class="brand-mark">Q</span><span>Quietdrop</span></a>
        <div class="nav-actions">
          <a href="/admin/login" class="nav-link">Admin login</a>
          <a href="/admin/register" class="primary-link">Create your inbox</a>
        </div>
      </nav>

      <section class="hero-row">
        <div class="hero-copy">
          <p class="eyebrow">An anonymous message system</p>
          <h1>Send me an <span>anonymous</span> message</h1>
          <p class="subcopy">Your identity is not shown to the recipient. Share your personal link and let honest messages come through without a profile.</p>
          <div class="hero-actions">
            <a href="/admin/register" class="primary-button">Open your inbox</a>
            <a href="/admin/login" class="secondary-button">Admin access</a>
          </div>
        </div>

        <div class="hero-card" aria-label="Anonymous note illustration">
          <div class="note-card note-back">
            <span>Anonymous</span>
            <div class="note-lines"></div>
            <div class="note-lines short"></div>
          </div>
          <div class="note-card note-front">
            <p>“You make hard days feel lighter.”</p>
            <small>— someone who noticed</small>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderAuth(mode = 'login') {
  const isRegister = mode === 'register';
  root.innerHTML = `
    <main class="page-shell auth-shell">
      <div class="auth-panel">
        <a href="/" class="brand"><span class="brand-mark">Q</span><span>Quietdrop</span></a>
        <p class="eyebrow">${isRegister ? 'Create admin access' : 'Admin login'}</p>
        <h1>${isRegister ? 'Create your inbox' : 'Welcome back'}</h1>
        <form id="auth-form" class="stack-form">
          ${isRegister ? '<label>Username<input name="username" type="text" maxlength="30" placeholder="shahin" required /></label>' : ''}
          <label>Email<input name="email" type="email" autocomplete="email" required /></label>
          <label>Password<input name="password" type="password" minlength="8" autocomplete="current-password" required /></label>
          <div class="notice" data-notice aria-live="polite"></div>
          <button type="submit" class="primary-button full-width">${isRegister ? 'Create account' : 'Sign in'}</button>
        </form>
        <p class="switch-copy">
          ${isRegister ? 'Already have an inbox?' : 'Need a new inbox?'}
          <a href="${isRegister ? '/admin/login' : '/admin/register'}">${isRegister ? 'Sign in' : 'Create one'}</a>
        </p>
      </div>
    </main>
  `;
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

async function renderDashboard() {
  if (!supabase || !state.user) {
    renderAuth('login');
    return;
  }

  try {
    await loadProfileForUser();
    if (!state.profile) {
      root.innerHTML = `
        <main class="page-shell config-shell">
          <div class="config-card">
            <p class="eyebrow">Profile required</p>
            <h1>No inbox yet</h1>
            <p class="subcopy">Create a username in the registration flow to generate your personal anonymous link.</p>
            <a href="/admin/register" class="primary-button">Create profile</a>
          </div>
        </main>
      `;
      return;
    }

    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('admin_id', state.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    state.messages = messages || [];

    const unreadCount = state.messages.filter((message) => !message.is_read).length;
    const linkUrl = getPublicLink(state.profile.username);

    root.innerHTML = `
      <main class="dashboard-shell">
        <aside class="sidebar">
          <div class="brand-wrap">
            <a href="/" class="brand"><span class="brand-mark">Q</span><span>Quietdrop</span></a>
          </div>
          <nav class="sidebar-nav">
            <a href="/admin/dashboard" class="active">Inbox</a>
          </nav>
          <button class="logout-button" data-action="logout">Logout</button>
        </aside>

        <section class="dashboard-content">
          <header class="dashboard-header">
            <div>
              <p class="eyebrow">Your anonymous inbox</p>
              <h1>${escapeHtml(state.profile.username)}'s messages</h1>
            </div>
            <button class="secondary-button" data-action="refresh-dashboard">Refresh</button>
          </header>

          <section class="stats-grid">
            <div class="stat-card">
              <span>Total</span>
              <strong>${state.messages.length}</strong>
            </div>
            <div class="stat-card">
              <span>Unread</span>
              <strong>${unreadCount}</strong>
            </div>
            <div class="stat-card">
              <span>Read</span>
              <strong>${state.messages.filter((message) => message.is_read).length}</strong>
            </div>
          </section>

          <div class="share-panel">
            <div>
              <p class="eyebrow">Anonymous link</p>
              <a class="share-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noreferrer">${escapeHtml(linkUrl)}</a>
            </div>
            <div class="action-row">
              <button class="secondary-button" data-action="copy-link">Copy link</button>
              <button class="secondary-button" data-action="open-link">Open link</button>
              <button class="secondary-button" data-action="show-qr">QR code</button>
            </div>
          </div>

          <div class="inbox-header">
            <h2>Anonymous messages</h2>
            <span class="count-pill">${state.messages.length}</span>
          </div>

          <div class="notice" data-notice aria-live="polite"></div>

          <div class="message-list">
            ${state.messages.length === 0 ? '<div class="empty-state">No messages yet.</div>' : ''}
            ${state.messages.map((message) => `
              <article class="message-card" data-id="${message.id}">
                <div class="message-topline">
                  <span class="status ${message.is_read ? 'read' : 'unread'}">${message.is_read ? 'Read' : 'Unread'}</span>
                  <time>${escapeHtml(formatRelativeTime(message.created_at))}</time>
                </div>
                <p>${escapeHtml(message.message || 'Message with image attachment')}</p>
                <div class="media-preview" data-media-preview="${message.id}"></div>
                <div class="message-actions">
                  <button data-action="toggle-read" data-id="${message.id}">${message.is_read ? 'Mark unread' : 'Mark read'}</button>
                  <button data-action="delete-message" data-id="${message.id}" class="danger-action">Delete</button>
                </div>
              </article>
            `).join('')}
          </div>
        </section>
      </main>
    `;

    const previewNodes = document.querySelectorAll('[data-media-preview]');
    previewNodes.forEach(async (node) => {
      const message = state.messages.find((item) => item.id === node.dataset.mediaPreview);
      if (!message || !message.media_path) return;

      try {
        const { data, error } = await supabase.storage.from('message-media').createSignedUrl(message.media_path, 3600);
        if (error || !data?.signedUrl) throw error || new Error('No signed URL');

        const mediaElement = message.media_type?.startsWith('video/')
          ? `<video controls src="${escapeHtml(data.signedUrl)}" preload="metadata"></video>`
          : `<img src="${escapeHtml(data.signedUrl)}" alt="Anonymous message media" />`;

        node.innerHTML = mediaElement;
      } catch {
        node.innerHTML = '<span class="media-fallback">Media unavailable</span>';
      }
    });
  } catch (error) {
    setNotice(error.message || 'The dashboard could not be loaded.', 'error');
  }
}

async function fetchProfileByUsername(username) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, created_at')
    .eq('username', username)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data;
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
        <a href="/" class="brand public-brand"><span class="brand-mark">Q</span><span>Quietdrop</span></a>
        <section class="message-panel">
          <p class="eyebrow">Send an anonymous message</p>
          <h1>Send me an anonymous message</h1>
          <p class="subcopy">Your identity isn't shown to the recipient.</p>

          <form id="message-form" class="stack-form">
            <textarea name="message" maxlength="4000" placeholder="Write your message..." required></textarea>
            <div class="compose-row">
              <label class="upload-label" for="media-input">Add image/GIF</label>
              <span class="limit-copy">Max ${maxMb} MB</span>
            </div>
            <input id="media-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
            <div id="file-preview" class="file-preview"></div>
            <div class="notice" data-notice aria-live="polite"></div>
            <button type="submit" class="primary-button full-width">Send anonymously</button>
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

      validateMediaFile(inputFile);
      const previewUrl = URL.createObjectURL(inputFile);
      filePreview.innerHTML = `<img src="${previewUrl}" alt="Selected upload preview" />`;
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
          const path = `${profile.id}/${filename}`;
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

        const { data, error } = await supabase.rpc('insert_anonymous_message', {
          p_username: profile.username,
          p_message: messageText,
          p_media_path: mediaPath,
          p_media_type: mediaType,
        });

        if (error) throw error;

        state.lastSubmissionAt = Date.now();
        localStorage.setItem('quietdrop-last-submit', String(state.lastSubmissionAt));

        root.innerHTML = `
          <main class="page-shell success-shell">
            <div class="config-card">
              <p class="eyebrow">Message sent</p>
              <h1>Message received.</h1>
              <p class="subcopy">Your message is now in ${escapeHtml(profile.username)}'s inbox.</p>
              <a href="/" class="primary-button">Send another</a>
            </div>
          </main>
        `;
      } catch (error) {
        setNotice(error.message || 'Your message was not sent.', 'error');
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

async function handleRegister(data) {
  const email = String(data.email || '').trim();
  const password = String(data.password || '');
  const username = validateUsername(data.username || '');

  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signUpError) {
    throw signUpError;
  }

  const user = signUpData.user;
  if (!user?.id) {
    throw new Error('Your account could not be created.');
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    throw new Error('Account created. Please confirm your email before signing in.');
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: user.id,
    username,
    created_at: new Date().toISOString(),
  });

  if (profileError) {
    if (profileError.code === '23505') {
      throw new Error('That username is already taken. Try another.');
    }
    throw profileError;
  }
}

async function handleLogin(data) {
  const email = String(data.email || '').trim();
  const password = String(data.password || '');

  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.target instanceof HTMLFormElement ? event.target : event.currentTarget?.querySelector?.('#auth-form');

  if (!(form instanceof HTMLFormElement)) {
    setNotice('The form could not be submitted.', 'error');
    return;
  }

  const data = Object.fromEntries(new FormData(form));
  const routeMode = window.location.pathname.includes('/register') ? 'register' : 'login';

  try {
    setNotice('Working…');
    if (routeMode === 'register') {
      await handleRegister(data);
    } else {
      await handleLogin(data);
    }

    location.href = '/admin/dashboard';
  } catch (error) {
    setNotice(error.message || 'Authentication failed.', 'error');
  }
}

async function handleDeleteMessage(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;

  const confirmed = window.confirm('Delete this anonymous message?');
  if (!confirmed) return;

  const { error } = await supabase.from('messages').delete().eq('id', id).eq('admin_id', state.user.id);
  if (error) {
    setNotice(error.message || 'Message could not be deleted.', 'error');
    return;
  }

  if (message.media_path) {
    await supabase.storage.from('message-media').remove([message.media_path]);
  }

  await renderDashboard();
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
    setNotice(error.message || 'The status update failed.', 'error');
    return;
  }

  await renderDashboard();
}

async function handleLogout() {
  if (!supabase) return;
  await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  location.href = '/admin/login';
}

async function route() {
  if (!supabaseConfig.isReady) {
    root.innerHTML = `
      <main class="page-shell config-shell">
        <div class="config-card">
          <p class="eyebrow">Setup required</p>
          <h1>Connect Supabase.</h1>
          <p class="subcopy">Add your Vite Supabase URL and anon key to the environment variables before using the app.</p>
        </div>
      </main>
    `;
    return;
  }

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/admin/login') {
    renderAuth('login');
    return;
  }

  if (pathname === '/admin/register') {
    renderAuth('register');
    return;
  }

  if (pathname === '/admin/dashboard') {
    if (!state.user) {
      renderAuth('login');
      return;
    }
    await renderDashboard();
    return;
  }

  const match = pathname.match(/^\/message\/(.+)$/);
  if (match) {
    const username = decodeURIComponent(match[1]);
    await renderPublicMessage(username);
    return;
  }

  renderHome();
}

root.addEventListener('submit', async (event) => {
  if (event.target.matches('#auth-form')) {
    await handleAuthSubmit(event);
  }
});

root.addEventListener('click', async (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;

  switch (action) {
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
    case 'delete-message':
      await handleDeleteMessage(actionTarget.dataset.id);
      break;
    case 'toggle-read':
      await handleToggleRead(actionTarget.dataset.id);
      break;
    default:
      break;
  }
});

if (supabase) {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.user = session?.user ?? null;
    try {
      await loadProfileForUser();
      await route();
    } catch (error) {
      setNotice(error.message || 'Authentication state could not be loaded.', 'error');
    }
  });

  (async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    state.user = sessionData?.session?.user ?? null;
    try {
      await loadProfileForUser();
      await route();
    } catch (error) {
      setNotice(error.message || 'Unable to load the app.', 'error');
    }
  })();
} else {
  route();
}

window.addEventListener('popstate', route);
