import './styles.css';
import { observeSession, loginAccount, logoutAccount, registerAccount, resetPassword, ensureAnonymousSession } from './firebase/auth.js';
import { firebaseConfigured } from './firebase/config.js';
import { findOwnedDestination, listDestinationMessages } from './firebase/firestore.js';
import { createDestination, createReport, deleteMessage, getPublicDestination, markMessageRead, moderateMessage, startMessageUpload, submitAnonymousMessage } from './firebase/api.js';
import { getPrivateMediaUrl, uploadReservedMedia, validateMedia } from './firebase/storage.js';

const root = document.querySelector('#app');
let currentUser = null;
let busy = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function setNotice(message = '', kind = 'info') {
  const notice = document.querySelector('[data-notice]');
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.kind = kind;
}

function frame(content, active = 'inbox') {
  return `<div class="layout">
    <aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">q</span><span>quietdrop</span></a>
      <div class="side-label">YOUR SPACE</div>
      <nav class="side-nav"><a class="${active === 'inbox' ? 'selected' : ''}" href="/">⌂ <span>Inbox</span></a><a href="#link">↗ <span>Your link</span></a><a href="#settings">⚙ <span>Settings</span></a></nav>
      <div class="side-bottom"><span class="presence"></span><span>Private by design</span></div>
    </aside>
    <main class="workspace"><header class="topbar"><div class="crumb">YOUR SPACE <span>/</span> ${active.toUpperCase()}</div><button class="avatar" data-action="logout" title="Sign out">${escapeHtml((currentUser?.displayName || currentUser?.email || 'Y').slice(0, 1).toUpperCase())}</button></header>
    ${content}</main></div>`;
}

function renderPublic(destination) {
  root.innerHTML = `<main class="public-page"><a class="brand public-brand" href="/"><span class="brand-mark">q</span><span>quietdrop</span></a>
    <section class="message-panel"><div class="eyebrow"><span class="eyebrow-dot"></span> A PRIVATE NOTE</div>
      <h1>Send an anonymous<br />message to <em>${escapeHtml(destination.name)}</em></h1>
      <p class="subcopy">Your identity isn't shown to the recipient.</p>
      <form id="message-form"><label class="sr-only" for="message-text">Your message</label><textarea id="message-text" name="text" maxlength="4000" placeholder="Write what you’ve been meaning to say..." required></textarea>
      <div class="compose-footer"><span class="char-count"><span id="char-count">0</span> / 4,000</span><label class="attach-button" for="media-input">＋ Add media</label><input class="sr-only" id="media-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" multiple /></div>
      <div class="file-list" id="file-list"></div><div class="notice" data-notice aria-live="polite"></div><button class="send-button" type="submit"><span>Send anonymously</span><span aria-hidden="true">↗</span></button></form>
      <div class="privacy-note"><span>◈</span> Messages are reviewed before delivery.</div>
    </section><footer class="public-footer">A little more honesty, a little less noise.</footer></main>`;
  if (!destination.allowMessages) {
    document.querySelector('#message-form').replaceWith('<p class="subcopy">This inbox is not accepting messages right now.</p>');
    return;
  }
  document.querySelector('.attach-button').hidden = !destination.allowMedia;
  document.querySelector('#media-input').disabled = !destination.allowMedia;
  const text = document.querySelector('#message-text');
  text.addEventListener('input', () => { document.querySelector('#char-count').textContent = text.value.length; });
  const files = document.querySelector('#media-input');
  files.addEventListener('change', () => {
    const selected = [...files.files];
    document.querySelector('#file-list').textContent = selected.map((file) => `${file.name} · ${formatBytes(file.size)}`).join('  /  ');
  });
  document.querySelector('#message-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    busy = true;
    submit.disabled = true;
    setNotice('Sending securely…');
    try {
      await ensureAnonymousSession();
      const selected = [...files.files];
      if (selected.length > 3) throw new Error('Choose up to 3 attachments.');
      const details = selected.map((file) => ({ file, validated: validateMedia(file) }));
      const reservation = await startMessageUpload({
        destinationSlug: destination.slug,
        files: details.map(({ file, validated }) => ({ name: file.name, ...validated })),
      });
      const attachments = await Promise.all(details.map(async ({ file, validated }, index) => {
        const reserved = reservation.uploads[index];
        await uploadReservedMedia(reserved.path, file, validated.contentType, (progress) => {
          setNotice(`Uploading attachment ${index + 1} of ${details.length} · ${Math.round(progress * 100)}%`);
        });
        return { path: reserved.path, name: reserved.name, type: validated.type };
      }));
      const result = await submitAnonymousMessage({
        requestId: reservation.requestId,
        text: text.value,
        attachments,
      });
      root.innerHTML = `<main class="success-page"><a class="brand public-brand" href="/"><span class="brand-mark">q</span><span>quietdrop</span></a><div class="success-mark">✓</div><p class="eyebrow">NOTE RECEIVED</p><h1>A note, now<br /><em>on its way.</em></h1><p class="subcopy">${result.status === 'needs_review' ? 'It will be checked before it reaches the inbox.' : 'It will appear in the inbox after a quick review.'}</p><a class="text-link" href="/u/${encodeURIComponent(destination.slug)}">Send another note <span>↗</span></a></main>`;
    } catch (error) {
      setNotice(readableError(error), 'error');
      submit.disabled = false;
    } finally {
      busy = false;
    }
  });
}

function formatBytes(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function readableError(error) {
  const code = error?.code || '';
  if (code.includes('unauthenticated') || code.includes('permission-denied')) return 'This request could not be completed. Please try again.';
  if (code.includes('unavailable')) return 'The service is temporarily unavailable. Try again shortly.';
  return error?.message || 'Something went wrong. Please try again.';
}

function renderGate(mode = 'login') {
  const registering = mode === 'register';
  root.innerHTML = `<main class="auth-page"><a class="brand public-brand" href="/"><span class="brand-mark">q</span><span>quietdrop</span></a><section class="auth-panel"><div class="eyebrow"><span class="eyebrow-dot"></span> YOUR PRIVATE INBOX</div><h1>${registering ? 'Make room for' : 'Good to hear'}<br /><em>${registering ? 'honest notes.' : 'you again.'}</em></h1><p class="subcopy">${registering ? 'Create an inbox for the things people find hard to say out loud.' : 'Sign in to read the notes sent your way.'}</p><form id="auth-form">${registering ? '<label>Display name<input name="displayName" maxlength="60" autocomplete="name" required /></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" minlength="8" autocomplete="${registering ? 'new-password' : 'current-password'}" required /></label><div class="notice" data-notice aria-live="polite"></div><button class="send-button" type="submit"><span>${registering ? 'Create account' : 'Sign in'}</span><span aria-hidden="true">↗</span></button></form>${registering ? '' : '<button class="reset-button" type="button" data-action="reset-password">Forgot password?</button>'}<p class="auth-switch">${registering ? 'Already have an inbox?' : 'New around here?'} <a href="?${registering ? 'login' : 'register'}">${registering ? 'Sign in' : 'Create account'}</a></p></section></main>`;
  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (registering) await registerAccount(data);
      else await loginAccount(data);
      await route();
    } catch (error) {
      setNotice(readableError(error), 'error');
    }
  });
  if (!registering) {
    document.querySelector('[data-action="reset-password"]').addEventListener('click', async () => {
      const email = document.querySelector('input[name="email"]').value;
      if (!email) return setNotice('Enter your email address first.', 'error');
      try {
        await resetPassword(email);
        setNotice('Password reset email sent.');
      } catch (error) { setNotice(readableError(error), 'error'); }
    });
  }
}

function renderDashboard() {
  root.innerHTML = frame(`<section class="dash-content"><div class="dash-heading"><div><div class="eyebrow">MONDAY, SEPTEMBER 26</div><h1>Your inbox, <em>in focus.</em></h1><p class="subcopy">A quiet place for the things left unsaid.</p></div><button class="outline-button" data-action="refresh">↻ <span>Refresh</span></button></div>
    <div class="stats-row"><article class="stat"><span class="stat-label">ALL NOTES</span><strong id="stat-total">—</strong><span class="stat-foot">in your inbox</span></article><article class="stat"><span class="stat-label">PENDING</span><strong id="stat-pending">—</strong><span class="stat-foot">awaiting a look</span></article><article class="stat"><span class="stat-label">APPROVED</span><strong id="stat-approved">—</strong><span class="stat-foot">ready to read</span></article><article class="stat"><span class="stat-label">REPORTED</span><strong id="stat-reported">—</strong><span class="stat-foot">flagged for review</span></article></div>
    <section class="link-strip"><div><span class="eyebrow">YOUR ANONYMOUS LINK</span><div class="share-url" id="share-url">Create a destination to get your link</div></div><div class="link-actions"><button class="outline-button" data-action="copy">Copy link</button><button class="send-button compact" data-action="new-destination">＋ <span>New link</span></button></div></section>
    <section class="inbox-section"><div class="section-heading"><div><span class="eyebrow">INCOMING</span><h2>Recent notes <span id="message-count" class="count-pill">0</span></h2></div><label class="filter-select">All notes <span>⌄</span><select id="status-filter" aria-label="Filter messages"><option value="all">All notes</option><option value="unread">Unread</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="needs_review">Needs review</option><option value="reported">Reported</option><option value="archived">Archived</option></select></label></div><div class="message-list" id="message-list"><div class="empty-state">Create a private link to start receiving notes.</div></div></section>
    <div class="notice dash-notice" data-notice aria-live="polite"></div></section>`);
  document.querySelector('[data-action="refresh"]').addEventListener('click', loadInbox);
  document.querySelector('[data-action="new-destination"]').addEventListener('click', createLink);
  document.querySelector('[data-action="copy"]').addEventListener('click', copyLink);
  document.querySelector('#status-filter').addEventListener('change', filterMessages);
  loadInbox();
}

let inboxMessages = [];
let activeDestination = null;

async function loadInbox() {
  try {
    activeDestination = await findOwnedDestination(currentUser.uid);
    const url = document.querySelector('#share-url');
    if (activeDestination) {
      url.textContent = `${location.origin}/u/${activeDestination.slug}`;
      inboxMessages = await listDestinationMessages(activeDestination.id);
      updateStats(inboxMessages);
      filterMessages();
    } else {
      url.textContent = 'Create a destination to get your link';
      inboxMessages = [];
      updateStats([]);
      document.querySelector('#message-list').innerHTML = '<div class="empty-state">Create your first anonymous link above.</div>';
    }
  } catch (error) {
    setNotice(readableError(error), 'error');
  }
}

function updateStats(messages) {
  document.querySelector('#stat-total').textContent = messages.length;
  document.querySelector('#stat-pending').textContent = messages.filter((item) => item.status === 'pending' || item.status === 'needs_review').length;
  document.querySelector('#stat-approved').textContent = messages.filter((item) => item.status === 'approved').length;
  document.querySelector('#stat-reported').textContent = messages.filter((item) => item.reported === true).length;
}

function filterMessages() {
  const filter = document.querySelector('#status-filter').value;
  const selected = inboxMessages.filter((item) => filter === 'all'
    || (filter === 'unread' && !item.readAt)
    || (filter === 'reported' && item.reported === true)
    || item.status === filter);
  document.querySelector('#message-count').textContent = selected.length;
  const list = document.querySelector('#message-list');
  if (!selected.length) {
    list.innerHTML = '<div class="empty-state">No notes in this view. The quiet is yours to keep.</div>';
    return;
  }
  list.innerHTML = selected.map((message) => `<article class="message-item" data-message="${escapeHtml(message.id)}"><div class="message-avatar">a</div><div class="message-body"><div class="message-meta"><strong>Anonymous</strong><span class="status status-${escapeHtml(message.status)}">${escapeHtml(message.status.replace('_', ' '))}</span><time>${message.createdAt?.toDate ? message.createdAt.toDate().toLocaleDateString() : 'Just now'}</time></div><p>${escapeHtml(message.text || '')}</p>${message.attachments?.length ? `<span class="attachment-count">▧ ${message.attachments.length} attachment${message.attachments.length === 1 ? '' : 's'}</span><div class="media-preview" data-media="${escapeHtml(message.id)}"></div>` : ''}<div class="message-actions">${!message.readAt ? '<button data-read>Mark read</button>' : ''}${message.status !== 'approved' ? `<button data-moderate="approved">Approve</button>` : ''}<button data-moderate="rejected">Reject</button><button data-moderate="archived">Archive</button><button data-report>Report</button><button data-delete>Delete</button></div></div></article>`).join('');
  list.querySelectorAll('[data-moderate]').forEach((button) => button.addEventListener('click', async () => {
    const item = button.closest('[data-message]');
    try {
      await moderateMessage({ messageId: item.dataset.message, status: button.dataset.moderate });
      await loadInbox();
      setNotice(`Note ${button.dataset.moderate}.`);
    } catch (error) { setNotice(readableError(error), 'error'); }
  }));
  list.querySelectorAll('[data-report]').forEach((button) => button.addEventListener('click', async () => {
    const messageId = button.closest('[data-message]').dataset.message;
    const reason = prompt('What should the moderation team review?');
    if (!reason) return;
    try {
      await createReport({ messageId, reason });
      setNotice('Report sent for review.');
    } catch (error) { setNotice(readableError(error), 'error'); }
  }));
  list.querySelectorAll('[data-read]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await markMessageRead({ messageId: button.closest('[data-message]').dataset.message });
      await loadInbox();
    } catch (error) { setNotice(readableError(error), 'error'); }
  }));
  list.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
    const messageId = button.closest('[data-message]').dataset.message;
    if (!confirm('Delete this note and its attachments?')) return;
    try {
      await deleteMessage({ messageId });
      await loadInbox();
      setNotice('Note deleted.');
    } catch (error) { setNotice(readableError(error), 'error'); }
  }));
  selected.forEach((message) => message.attachments?.forEach(async (attachment) => {
    try {
      const url = await getPrivateMediaUrl(attachment.path);
      const preview = list.querySelector(`[data-media="${CSS.escape(message.id)}"]`);
      if (!preview) return;
      preview.insertAdjacentHTML('beforeend', attachment.type === 'video'
        ? `<video controls preload="metadata" src="${escapeHtml(url)}"></video>`
        : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="Message attachment" /></a>`);
    } catch { /* Private attachment may no longer be available. */ }
  }));
}

async function createLink() {
  const slug = prompt('Choose a short link name (letters, numbers, and hyphens):');
  if (!slug) return;
  try {
    const result = await createDestination({ name: currentUser.displayName || 'My inbox', slug });
    activeDestination = result;
    await loadInbox();
  } catch (error) { setNotice(readableError(error), 'error'); }
}

async function copyLink() {
  if (!activeDestination) return setNotice('Create a destination first.', 'error');
  await navigator.clipboard.writeText(`${location.origin}/u/${activeDestination.slug}`);
  setNotice('Link copied.');
}

function renderHome() {
  root.innerHTML = `<main class="home-page"><nav class="home-nav"><a class="brand" href="/"><span class="brand-mark">q</span><span>quietdrop</span></a><div class="home-nav-actions"><a class="nav-login" href="?login">Sign in</a><a class="nav-join" href="?register">Open your inbox <span>↗</span></a></div></nav><section class="home-hero"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-dot"></span> THE THINGS LEFT UNSAID</div><h1>Say it.<br /><em>Without a name.</em></h1><p>Your thoughts. Your story. Stay anonymous. Your identity isn't shown to the recipient.</p><div class="hero-actions"><a class="hero-cta" href="?register">Create your anonymous link <span>↗</span></a><button class="hero-secondary" data-action="send-to-user">Send an anonymous message</button></div><div class="hero-foot"><span>01 / PRIVATE BY DESIGN</span><span>NO ACCOUNT NEEDED TO SEND</span></div></div><div class="hero-art" aria-hidden="true"><div class="note note-back"><span>AN OPEN NOTE</span><div class="note-lines"></div><div class="note-lines short"></div></div><div class="note note-front"><div class="note-tag"><span class="eyebrow-dot"></span> FROM SOMEONE, SOMEWHERE</div><p>“You make hard days<br />feel a little lighter.”</p><div class="note-signature">— someone who noticed</div><div class="note-seal">q</div></div><div class="art-caption">A NOTE WITHOUT A NAME <span>✳</span></div></div></section><section class="home-details"><div class="details-heading"><span class="eyebrow">THREE STEPS, NO INTRODUCTIONS</span><h2>How it works</h2></div><div class="steps-grid"><article class="step-item"><span>01</span><h3>Create your inbox</h3><p>Choose a link for your personal anonymous inbox.</p></article><article class="step-item"><span>02</span><h3>Share your link</h3><p>Send it to friends, classmates, or your community.</p></article><article class="step-item"><span>03</span><h3>Receive honest notes</h3><p>Read messages privately in your own dashboard.</p></article></div><div class="feature-grid"><article class="feature-item"><span class="feature-symbol">◈</span><div><h3>Anonymous</h3><p>Your identity isn't shown to the recipient.</p></div></article><article class="feature-item"><span class="feature-symbol">▧</span><div><h3>Media support</h3><p>Send photos, videos, and GIFs with a note.</p></div></article><article class="feature-item"><span class="feature-symbol">⌑</span><div><h3>Moderated</h3><p>Reporting and review tools help protect inboxes.</p></div></article></div></section><section class="home-band"><div><span class="eyebrow">SAY IT SIMPLY</span><p>One link. One honest thought.<br />No introductions required.</p></div><a href="?register">Create your private inbox <span>↗</span></a></section><footer class="home-footer"><span>QUIETDROP © 2026</span><span>YOUR IDENTITY ISN'T SHOWN TO THE RECIPIENT</span></footer></main>`;
  document.querySelector('[data-action="send-to-user"]').addEventListener('click', () => {
    const input = prompt('Enter their username or /u/username link:');
    if (!input) return;
    const slug = input.trim().replace(/^.*\/u\//i, '').replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
      alert('Enter a valid inbox username.');
      return;
    }
    location.href = `/u/${encodeURIComponent(slug)}`;
  });
}

async function route() {
  const path = location.pathname.split('/').filter(Boolean);
  const params = new URLSearchParams(location.search);
  if (!firebaseConfigured) {
    root.innerHTML = `<main class="config-page"><div class="brand"><span class="brand-mark">q</span><span>quietdrop</span></div><div class="eyebrow">SETUP REQUIRED</div><h1>Connect your<br /><em>Firebase project.</em></h1><p class="subcopy">Copy .env.example to .env and add your Firebase web app settings. See the README for setup steps.</p></main>`;
    return;
  }
  if (path[0] === 'u' && path[1]) {
    try {
      const destination = await getPublicDestination({ type: 'user', slug: path[1] });
      destination ? renderPublic(destination) : (root.innerHTML = '<main class="config-page"><div class="eyebrow">LINK NOT FOUND</div><h1>This inbox<br /><em>isn’t here.</em></h1><a class="text-link" href="/">Go home ↗</a></main>');
    } catch (error) {
      root.innerHTML = error?.code?.includes('not-found')
        ? '<main class="config-page"><div class="eyebrow">LINK NOT FOUND</div><h1>This inbox<br /><em>isn’t here.</em></h1><a class="text-link" href="/">Go home ↗</a></main>'
        : '<main class="config-page"><div class="eyebrow">TEMPORARY ISSUE</div><h1>We couldn’t<br /><em>open this inbox.</em></h1><p class="subcopy">Please try again shortly.</p></main>';
    }
    return;
  }
  if (!currentUser) return params.has('register') ? renderGate('register') : params.has('login') ? renderGate('login') : renderHome();
  renderDashboard();
}

root.addEventListener('click', async (event) => {
  if (event.target.closest('[data-action="logout"]')) await logoutAccount();
});

if (firebaseConfigured) observeSession((user) => {
  currentUser = user && !user.isAnonymous ? user : null;
  route();
});
else route();