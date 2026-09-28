import './styles.css';
import QRCode from 'qrcode';
import { supabase, supabaseConfig } from './supabase.js';

const INBOX_USERNAME = encodeURIComponent(import.meta.env.VITE_INBOX_USERNAME || 'quietdrop');

const root = document.querySelector('#app');
const state = {
  user: null,
  profile: null,
  messages: [],
  comments: [],
  dashboardSection: 'inbox',
  commentStatus: 'pending',
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

function getPublicLink(username = '') {
  return `${window.location.origin}/message/${encodeURIComponent(username || state.profile?.username || 'quietdrop')}`;
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
        <a href="/" class="brand"><img src="/logo.jpg" class="brand-logo" alt="CETP Confessions logo" /><span>CETP Confessions</span></a>
        <div class="nav-actions">
          <a href="/public" class="nav-link">Public Board</a>
          <a href="/admin/login" class="nav-link">Admin login</a>
          <a href="/message/${INBOX_USERNAME}" class="primary-button">Send Confession</a>
        </div>
      </nav>

      <section class="hero-row">
        <div class="hero-copy">
          <p class="eyebrow">The voice of our campus</p>
          <h1>Unspoken thoughts, <span>shared securely.</span></h1>
          <p class="subcopy">Welcome to CETP Confessions—the digital heartbeat of our campus. Whether it's a hidden crush, a hilarious classroom moment, or a heartfelt thank you, this is your safe space to speak freely without revealing who you are.</p>
          
          <div class="hero-actions">
            <a href="/message/${INBOX_USERNAME}" class="primary-button">Drop a Confession</a>
            <a href="/public" class="secondary-button">Read the Board</a>
          </div>

          <div class="features-grid">
            <div class="feature-item">
              <h3>🔒 100% Anonymous</h3>
              <p>Your identity is never logged or exposed. Speak your mind freely.</p>
            </div>
            <div class="feature-item">
              <h3>🛡️ Moderated</h3>
              <p>Every message is reviewed to keep our community safe and positive.</p>
            </div>
            <div class="feature-item">
              <h3>⏱️ Ephemeral</h3>
              <p>Approved posts auto-expire after 60 days to keep the feed fresh.</p>
            </div>
            <div class="feature-item">
              <h3>💬 Interactive</h3>
              <p>Reply to public confessions and keep the campus conversation going.</p>
            </div>
          </div>
        </div>

        <div class="hero-card" aria-label="Anonymous note illustration">
          <div class="note-card note-back">
            <span>Anonymous</span>
          </div>
          <div class="note-card note-front">
            <span>Anonymous</span>
            <p>"To the person who returned my lost flash drive in the library—you saved my entire semester!"</p>
            <small>— just now</small>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderAuth() {
  root.innerHTML = `
    <main class="page-shell auth-shell">
      <div class="auth-panel">
        <a href="/" class="brand"><img src="/logo.jpg" class="brand-logo" alt="CETP Confessions logo" /><span>CETP Confessions</span></a>
        <p class="eyebrow">Admin login</p>
        <h1>Welcome back</h1>
        <form id="auth-form" class="stack-form">
          <label>Email<input name="email" type="email" autocomplete="email" required /></label>
          <label>Password<input name="password" type="password" minlength="8" autocomplete="current-password" required /></label>
          <div class="notice" data-notice aria-live="polite"></div>
          <button type="submit" class="primary-button full-width">Sign in</button>
        </form>
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

async function renderDashboard(noticeMessage = '') {
  if (!supabase || !state.user) {
    renderAuth('login');
    return;
  }

  root.innerHTML = '<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Admin workspace</p><h1>Loading your inbox…</h1></div></main>';

  try {
    await loadProfileForUser();
    if (!state.profile) {
      root.innerHTML = '<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Admin profile unavailable</p><h1>No inbox is linked to this account.</h1><p class="subcopy">Ask the project administrator to link this account to an existing inbox.</p></div></main>';
      return;
    }

    const [{ data: messages, error: messageError }, { data: moderationCounts, error: countsError }] = await Promise.all([
      supabase.from('messages').select('*').eq('admin_id', state.user.id).order('created_at', { ascending: false }),
      supabase.rpc('get_moderation_counts'),
    ]);
    if (messageError) throw messageError;
    if (countsError) throw countsError;
    state.messages = messages || [];

    const messageIds = state.messages.map(m => m.id);
    let comments = [];
    if (messageIds.length > 0) {
      for (let i = 0; i < messageIds.length; i += 100) {
        const chunk = messageIds.slice(i, i + 100);
        const { data, error: commentError } = await supabase
          .from('message_comments')
          .select('*')
          .in('message_id', chunk)
          .order('created_at', { ascending: false });
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
        <aside class="sidebar">
          <div class="brand-wrap"><a href="/" class="brand"><img src="/logo.jpg" class="brand-logo" alt="CETP Confessions logo" /><span>CETP Confessions Admin</span></a></div>
          <nav class="sidebar-nav">
            <a href="/admin/dashboard" class="active">Dashboard</a>
            <a href="/public">Public View</a>
          </nav>
          <button class="logout-button" data-action="logout">Logout</button>
        </aside>
        <section class="dashboard-content">
          <header class="dashboard-header">
            <div><p class="eyebrow">Moderation workspace</p><h1>${escapeHtml(state.profile.username)}'s inbox</h1></div>
            <button class="secondary-button" data-action="refresh-dashboard">Refresh</button>
          </header>
          <section class="stats-grid moderation-stats">
            <div class="stat-card"><span>Pending messages</span><strong>${counts.pending}</strong></div>
            <div class="stat-card"><span>Approved messages</span><strong>${counts.approved}</strong></div>
            <div class="stat-card"><span>Rejected messages</span><strong>${counts.rejected}</strong></div>
            <div class="stat-card"><span>Pending comments</span><strong>${counts.pendingComments}</strong></div>
            <div class="stat-card"><span>Pinned messages</span><strong>${counts.pinned}</strong></div>
          </section>
          <div class="share-panel">
            <div><p class="eyebrow">Anonymous message link</p><a class="share-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noreferrer">${escapeHtml(linkUrl)}</a></div>
            <div class="action-row"><button class="secondary-button" data-action="copy-link">Copy link</button><button class="secondary-button" data-action="open-link">Open link</button><button class="secondary-button" data-action="show-qr">QR code</button></div>
          </div>
          <nav class="dashboard-tabs" aria-label="Moderation sections">
            ${sections.map(([key, label]) => `<button data-section="${key}" class="${state.dashboardSection === key ? 'active' : ''}">${label}</button>`).join('')}
          </nav>
          <div class="notice" data-notice aria-live="polite">${escapeHtml(noticeMessage)}</div>
          <p class="subcopy" style="margin-bottom: 1rem; font-size: 0.9rem;">Approved messages automatically expire 60 days after approval.</p>
          ${state.dashboardSection === 'comments' ? commentsPanel : `
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
                    expiresText = `<span class="status status-pending" style="background:rgba(255,255,255,0.2);color:#fff;">Auto-deletes in ${d}d ${h}h</span>`;
                  } else {
                    expiresText = `<span class="status status-rejected">Expired</span>`;
                  }
                }

                return `<article class="message-card" data-id="${message.id}">
                  <div class="message-topline">
                    <span class="status status-${message.status}">${message.status}${message.is_pinned ? ' · pinned' : ''}</span>
                    ${expiresText}
                    <time>${escapeHtml(formatRelativeTime(message.created_at))}</time>
                  </div>
                  <p>${escapeHtml(message.message || 'Message with image attachment')}</p>
                  <div class="media-preview" data-media-preview="${message.id}"></div>
                  <div class="message-actions">
                    ${message.status !== 'approved' ? `<button data-action="moderate-message" data-id="${message.id}" data-status="approved">Approve</button>` : `<button data-action="moderate-message" data-id="${message.id}" data-status="pending">Remove from Public</button>`}
                    ${message.status !== 'rejected' ? `<button data-action="moderate-message" data-id="${message.id}" data-status="rejected">Reject</button>` : ''}
                    <button data-action="toggle-pin" data-id="${message.id}">${message.is_pinned ? 'Unpin' : 'Pin'}</button>
                    <button data-action="toggle-read" data-id="${message.id}">${message.is_read ? 'Mark unread' : 'Mark read'}</button>
                    <button data-action="download-image" data-id="${message.id}">Download Image</button>
                    ${message.media_path ? `<button data-action="download-media" data-id="${message.id}">Download Attachment</button>` : ''}
                    <button class="danger-action" data-action="delete-message" data-id="${message.id}">Delete</button>
                  </div>
                  <details class="message-comments">
                    <summary>Comments (${relatedComments.length})</summary>
                    ${relatedComments.length ? relatedComments.map((comment) => `
                      <div class="comment-row">
                        <div>
                          <span class="status status-${comment.status}">${comment.status}</span>
                          <p>${escapeHtml(comment.comment_text || 'Response with media attachment')}</p>
                        </div>
                        <div class="message-actions">
                          ${comment.status !== 'approved' ? `<button data-action="moderate-comment" data-id="${comment.id}" data-status="approved">Approve</button>` : `<button data-action="moderate-comment" data-id="${comment.id}" data-status="pending">Hide</button>`}
                          ${comment.status !== 'rejected' ? `<button data-action="moderate-comment" data-id="${comment.id}" data-status="rejected">Reject</button>` : ''}
                          <button class="danger-action" data-action="delete-comment" data-id="${comment.id}">Delete</button>
                        </div>
                      </div>`).join('') : '<p class="context-copy">No responses yet.</p>'}
                  </details>
                </article>`;
              }).join('') : '<div class="empty-state">No messages in this section.</div>'}
            </div>
          `}
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
  } catch (error) {
    root.innerHTML = `<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Dashboard unavailable</p><h1>Moderation data could not be loaded.</h1><p class="subcopy">${escapeHtml(error.message || 'Check the database migration and RLS policies.')}</p></div></main>`;
  }
}

async function fetchProfileByUsername(username) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_public_profile', { p_username: username });

  if (error) throw error;

  return data?.[0] || null;
}

function publicNavigation() {
  return `
    <nav class="top-nav public-nav">
      <a href="/" class="brand"><img src="/logo.jpg" class="brand-logo" alt="CETP Confessions logo" /><span>CETP Confessions</span></a>
      <div class="nav-actions">
        <a href="/" class="nav-link">Home</a>
        <a href="/public" class="nav-link">Public Board</a>
        <a href="/admin/login" class="nav-link">Admin Login</a>
        <a href="/message/${INBOX_USERNAME}" class="primary-button">Send Confession</a>
      </div>
    </nav>
  `;
}

async function renderPublicConfessions(noticeMessage = '') {
  root.innerHTML = `
    <main class="public-page">
      ${publicNavigation()}
      <section class="public-content">
        <header class="public-heading">
          <p class="eyebrow">CETP Community Board</p>
          <h1>Campus Confessions</h1>
          <p class="subcopy">A safe, anonymous space where CETP students speak their minds. Every confession is moderated and stays live for 60 days.</p>
        </header>
        <div class="notice" data-notice aria-live="polite">${escapeHtml(noticeMessage || 'Loading confessions…')}</div>
        <div class="public-message-list" id="public-message-list"></div>
      </section>
    </main>
  `;

  try {
    const { data: messages, error } = await supabase.rpc('get_public_confessions');
    if (error) throw error;
    const list = document.querySelector('#public-message-list');
    document.querySelector('[data-notice]').textContent = noticeMessage;

    if (!messages?.length) {
      list.innerHTML = `
        <div class="empty-state public-empty"><h2>No confessions have been published yet.</h2><p>Be the first to share something anonymously.</p><a href="/message/${INBOX_USERNAME}" class="primary-button">Send Anonymous Message</a></div>
      `;
      return;
    }

    list.innerHTML = messages.map((message) => `
      <article class="public-message-card" data-public-message="${message.id}">
        <div class="message-topline"><span class="public-label">Anonymous Confession${message.is_pinned ? ' · Pinned' : ''}</span><time>${escapeHtml(formatRelativeTime(message.created_at))}</time></div>
        <p class="public-message-text">${escapeHtml(message.message || 'Message with image attachment')}</p>
        ${message.media_path ? `<div class="media-preview"><img data-public-media="${escapeHtml(message.media_path)}" alt="Anonymous confession attachment" /></div>` : ''}
        <div class="public-card-actions"><button class="secondary-button" data-action="toggle-comments" data-id="${message.id}" aria-expanded="false">Comments (${Number(message.comment_count) || 0})</button><button class="primary-button" data-action="reply-comment" data-id="${message.id}">Reply</button></div>
        <section class="comment-thread" data-comments="${message.id}" hidden></section>
      </article>
    `).join('');

    for (const image of document.querySelectorAll('[data-public-media]')) {
      const { data, error: mediaError } = await supabase.storage.from('message-media').createSignedUrl(image.dataset.publicMedia, 3600);
      if (!mediaError && data?.signedUrl) image.src = data.signedUrl;
      else image.closest('.media-preview')?.remove();
    }
  } catch (error) {
    setNotice(error.message || 'Public confessions could not be loaded.', 'error');
  }
}

async function loadPublicComments(messageId) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_public_comments', { p_message_id: messageId });
  if (error) throw error;
  return data || [];
}

async function openPublicComments(messageId, showReply = false) {
  const thread = document.querySelector(`[data-comments="${CSS.escape(messageId)}"]`);
  if (!thread) return;
  thread.hidden = false;
  const trigger = document.querySelector(`[data-action="toggle-comments"][data-id="${CSS.escape(messageId)}"]`);
  trigger?.setAttribute('aria-expanded', 'true');
  thread.innerHTML = '<p class="context-copy">Loading approved responses…</p>';

  try {
    const comments = await loadPublicComments(messageId);
    thread.innerHTML = `
      <div class="approved-comments">
        ${comments.length ? comments.map((comment) => `<article class="public-comment"><span>Anonymous Comment</span><p>${escapeHtml(comment.comment_text || 'Response with media attachment')}</p><time>${escapeHtml(formatRelativeTime(comment.created_at))}</time></article>`).join('') : '<p class="context-copy">No approved responses yet.</p>'}
      </div>
      <form class="comment-form" data-comment-form="${messageId}">
        <label class="sr-only" for="comment-${messageId}">Write an anonymous response</label>
        <textarea id="comment-${messageId}" name="comment" maxlength="4000" placeholder="Write an anonymous response..." required></textarea>
        <div class="notice" data-comment-notice="${messageId}" aria-live="polite"></div>
        <button type="submit" class="primary-button">Send Anonymously</button>
      </form>
    `;
    if (showReply) thread.querySelector('textarea')?.focus();
  } catch (error) {
    thread.innerHTML = `<p class="notice" data-kind="error">${escapeHtml(error.message || 'Responses could not be loaded.')}</p>`;
  }
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
        <a href="/" class="brand public-brand"><img src="/logo.jpg" class="brand-logo" alt="CETP Confessions logo" /><span>CETP Confessions</span></a>
        <section class="message-panel">
          <p class="eyebrow">Send an anonymous message</p>
          <h1>Send me an anonymous message</h1>
          <p class="subcopy">Your identity isn't shown to the recipient.</p>

          <div class="page-description">
            <h3>📝 What is this?</h3>
            <p>CETP Confessions is a safe, anonymous space for our campus community. Share a hidden crush, a funny classroom moment, a heartfelt thank-you, or anything on your mind — without revealing who you are.</p>
            <div class="description-details">
              <div class="detail-item"><span>🔒</span><p><strong>Completely anonymous</strong> — your identity is never logged or shared with anyone.</p></div>
              <div class="detail-item"><span>🛡️</span><p><strong>Moderated for safety</strong> — every message is reviewed by admins before it goes public.</p></div>
              <div class="detail-item"><span>📎</span><p><strong>Attach images</strong> — you can include a photo or GIF with your confession (max ${maxMb} MB).</p></div>
            </div>
          </div>

          <form id="message-form" class="stack-form">
            <textarea name="message" maxlength="4000" placeholder="Write your message..." required autocomplete="off"></textarea>
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
              <p class="eyebrow">Message sent</p>
              <h1>Message received.</h1>
              <p class="subcopy">Your anonymous message is in ${escapeHtml(profile.username)}'s inbox for review. It will appear publicly only after admin approval.</p>
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

async function handleLogin(data) {
  const email = String(data.email || '').trim();
  const password = String(data.password || '');

  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  state.user = signInData?.user ?? null;
  if (!state.user) throw new Error('Sign-in completed without an active session. Please try again.');
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.target instanceof HTMLFormElement ? event.target : event.currentTarget?.querySelector?.('#auth-form');

  if (!(form instanceof HTMLFormElement)) {
    setNotice('The form could not be submitted.', 'error');
    return;
  }

  const data = Object.fromEntries(new FormData(form));
  const submitButton = form.querySelector('button[type="submit"]');
  try {
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in…';
    setNotice('Signing in…');
    await handleLogin(data);
    window.history.replaceState(null, '', '/admin/dashboard');
    await route();
  } catch (error) {
    setNotice('Authentication failed. Please check your credentials.', 'error');
    submitButton.disabled = false;
    submitButton.textContent = 'Sign in';
  }
}

async function handleDeleteMessage(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;

  const confirmed = window.confirm('Delete this anonymous message?');
  if (!confirmed) return;

  const { error } = await supabase.from('messages').delete().eq('id', id).eq('admin_id', state.user.id);
  if (error) {
    setNotice('Message could not be deleted.', 'error');
    return;
  }

  if (message.media_path) {
    await supabase.storage.from('message-media').remove([message.media_path]);
  }

  await renderDashboard();
}

async function moderateMessage(id, status) {
  const { error } = await supabase.from('messages').update({ status }).eq('id', id).eq('admin_id', state.user.id);
  if (error) throw error;
  const messages = { approved: 'Message approved and published.', pending: 'Message removed from public view.', rejected: 'Message rejected.' };
  await renderDashboard(messages[status] || 'Message updated.');
}

async function toggleMessagePin(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;
  const { error } = await supabase.from('messages').update({ is_pinned: !message.is_pinned }).eq('id', id).eq('admin_id', state.user.id);
  if (error) throw error;
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

  const { error } = await supabase.from('message_comments').delete().eq('id', id);
  if (error) throw error;
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

async function handleDownloadMedia(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message?.media_path) {
    setNotice('This message has no media attachment.', 'error');
    return;
  }

  try {
    const { data, error } = await supabase.storage.from('message-media').createSignedUrl(message.media_path, 300);
    if (error || !data?.signedUrl) throw error || new Error('Could not create download link.');

    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error('Download failed.');
    const blob = await response.blob();

    const extension = message.media_path.split('.').pop() || 'png';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `attachment-${id}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } catch (err) {
    setNotice('The attachment could not be downloaded.', 'error');
  }
}

async function handleDownloadImage(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;

  // Pre-load the real logo
  const logoImg = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/logo.jpg';
  });

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#7b6faf';
  ctx.fillRect(0, 0, 1080, 1080);

  // White Card with rounded corners
  const cardX = 100, cardY = 100, cardW = 880, cardH = 880, r = 48;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cardX + r, cardY);
  ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + cardH, r);
  ctx.arcTo(cardX + cardW, cardY + cardH, cardX, cardY + cardH, r);
  ctx.arcTo(cardX, cardY + cardH, cardX, cardY, r);
  ctx.arcTo(cardX, cardY, cardX + cardW, cardY, r);
  ctx.closePath();
  ctx.fill();

  // Draw actual logo image in circle clip
  const logoSize = 110;
  const logoX = cardX + 80;
  const logoY = cardY + 80;

  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
    ctx.restore();
  } else {
    // Fallback circle if logo fails to load
    ctx.fillStyle = '#7b6faf';
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('C', logoX + logoSize / 2, logoY + logoSize / 2 + 13);
  }

  // Header Texts
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 44px Inter, sans-serif';
  ctx.fillText('Cetp Confessions', logoX + logoSize + 24, logoY + 52);
  ctx.fillStyle = '#64748b';
  ctx.font = '400 30px Inter, sans-serif';
  ctx.fillText('@confession.cetp', logoX + logoSize + 24, logoY + 96);

  // Divider under header
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 80, cardY + 220);
  ctx.lineTo(cardX + cardW - 80, cardY + 220);
  ctx.stroke();

  // Confession Text Wrapping
  ctx.fillStyle = '#0f172a';
  ctx.font = '500 46px Inter, sans-serif';
  const words = (message.message || '').split(' ');
  let line = '';
  let textY = cardY + 300;
  const maxWidth = cardW - 160;

  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), cardX + 80, textY);
      line = words[i] + ' ';
      textY += 66;
      if (textY > cardY + cardH - 160) { ctx.fillText('…', cardX + 80, textY); break; }
    } else {
      line = testLine;
    }
  }
  if (textY <= cardY + cardH - 160) ctx.fillText(line.trim(), cardX + 80, textY);

  // Bottom separator
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 80, cardY + cardH - 100);
  ctx.lineTo(cardX + cardW - 80, cardY + cardH - 100);
  ctx.stroke();

  // Download
  const link = document.createElement('a');
  link.download = `confession-${id}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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

  if (state.user && !pathname.startsWith('/admin')) {
    await supabase.auth.signOut();
    state.user = null;
    state.profile = null;
  }

  if (pathname === '/admin/login') {
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
    renderHome();
    return;
  }

  root.innerHTML = '<main class="page-shell config-shell"><div class="config-card"><p class="eyebrow">Page not found</p><h1>This page does not exist.</h1><a href="/" class="primary-button">Return home</a></div></main>';
}

root.addEventListener('submit', async (event) => {
  if (event.target.matches('#auth-form')) {
    await handleAuthSubmit(event);
    return;
  }

  const commentForm = event.target.closest('[data-comment-form]');
  if (commentForm) {
    event.preventDefault();
    const messageId = commentForm.dataset.commentForm;
    const commentText = new FormData(commentForm).get('comment')?.toString().trim() || '';
    const notice = commentForm.querySelector('[data-comment-notice]');
    if (!commentText) {
      notice.textContent = 'Write a response before sending.';
      notice.dataset.kind = 'error';
      return;
    }

    const submitButton = commentForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    notice.textContent = 'Sending for admin review…';
    try {
      const { error } = await supabase.rpc('submit_anonymous_comment', {
        p_message_id: messageId,
        p_comment_text: commentText,
        p_media_path: null,
        p_media_type: null,
      });
      if (error) throw error;
      await renderPublicConfessions('Response submitted for admin review.');
    } catch (error) {
      notice.textContent = 'Your response could not be sent. Please try again.';
      notice.dataset.kind = 'error';
      submitButton.disabled = false;
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
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;

  try {
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
    case 'download-image':
      await handleDownloadImage(actionTarget.dataset.id);
      break;
    case 'download-media':
      await handleDownloadMedia(actionTarget.dataset.id);
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
  supabase.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user ?? null;
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
