import { Fragment, useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { PublicNavbar } from './PublicNavbar.jsx';
import { GravityStarsBackground } from '@/components/animate-ui/components/backgrounds/gravity-stars.jsx';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient.jsx';
import { HoverEffect } from '@/components/ui/card-hover-effect.jsx';
import { LayoutTextFlip } from '@/components/ui/layout-text-flip.jsx';
import { LoaderOne } from '@/components/ui/loader-one.jsx';

function SpotlightSurface({ as: ElementType = 'div', className = '', children, ...props }) {
  function trackPointer(event) {
    if (event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
  }

  return (
    <ElementType className={className} onPointerMove={trackPointer} {...props}>
      {children}
    </ElementType>
  );
}

export function HomePage({ inboxUrl }) {
  const reduceMotion = useReducedMotion();
  return (
    <main className="page-shell home-shell">
      {!reduceMotion ? (
        <GravityStarsBackground
          className="absolute inset-0 z-0 pointer-events-none text-slate-900"
          starsCount={56}
          starsSize={1.4}
          starsOpacity={0.58}
          glowIntensity={8}
          movementSpeed={0.12}
          mouseInfluence={80}
          gravityStrength={35}
        />
      ) : null}
      <PublicNavbar activePath="/" />
      <section className="hero-row">
        <div className="hero-copy">
          <p className="eyebrow">The voice of our campus</p>
          <h1 className="hero-flip-heading">
            <LayoutTextFlip
              text="Unspoken thoughts, "
              words={["shared securely."]}
              duration={2200}
              textClassName="hero-flip-prefix"
              wordClassName="hero-flip-word"
              className="hero-flip-word-shell"
            />
          </h1>
          <p className="subcopy">
            Welcome to CETP Confessions—the digital heartbeat of our campus. Whether it's a hidden crush,
            a hilarious classroom moment, or a heartfelt thank you, this is your safe space to speak freely
            without revealing who you are.
          </p>
          <div className="hero-actions">
            <HoverBorderGradient as="a" href={inboxUrl} className="hero-gradient-content">Drop a Confession</HoverBorderGradient>
            <HoverBorderGradient as="a" href="/public" className="hero-gradient-content hero-gradient-secondary-content">Read the Board</HoverBorderGradient>
          </div>
          <div className="features-grid">
            <div className="feature-item">
              <h3>🔒 Anonymous to recipients</h3>
              <p>Your identity isn't shown to the recipient.</p>
            </div>
            <div className="feature-item">
              <h3>🛡️ Moderated</h3>
              <p>Every message is reviewed to keep our community safe and positive.</p>
            </div>
            <div className="feature-item">
              <h3>⏱️ Ephemeral</h3>
              <p>Approved posts auto-expire after 60 days to keep the feed fresh.</p>
            </div>
            <div className="feature-item">
              <h3>💬 Interactive</h3>
              <p>Reply to public confessions and keep the campus conversation going.</p>
            </div>
          </div>
        </div>
        <SpotlightSurface className="hero-card spotlight-card" aria-label="Anonymous note illustration">
          <div className="note-card note-back">
            <span>Anonymous</span>
          </div>
          <div className="note-card note-front">
            <span>Anonymous</span>
            <p>“To the person who returned my lost flash drive in the library—you saved my entire semester!”</p>
            <small>— just now</small>
          </div>
        </SpotlightSurface>
      </section>
    </main>
  );
}

export function PublicPage({ inboxUrl, fetchPage, formatRelativeTime, onOpenMessage, noticeMessage = '' }) {
  const reduceMotion = useReducedMotion();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState(noticeMessage || 'Loading confessions…');
  const [hasError, setHasError] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);
    fetchPage(0)
      .then((pageMessages) => {
        if (!isCurrent) return;
        setMessages(pageMessages);
        setHasMore(pageMessages.length === 20);
        setNotice(noticeMessage);
        setHasError(false);
      })
      .catch((error) => {
        if (isCurrent) {
          setNotice(error.message || 'Public confessions could not be loaded.');
          setHasError(true);
        }
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => { isCurrent = false; };
  }, [fetchPage, noticeMessage]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextOffset = offset + 20;
    try {
      const nextMessages = await fetchPage(nextOffset);
      setMessages((current) => [...current, ...nextMessages]);
      setOffset(nextOffset);
      setHasMore(nextMessages.length === 20);
    } catch (error) {
      setNotice(error.message || 'Public confessions could not be loaded.');
      setHasError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="public-page">
      {!reduceMotion ? <GravityStarsBackground className="absolute inset-0 z-0 pointer-events-none text-slate-900" starsCount={56} starsSize={1.4} starsOpacity={0.58} glowIntensity={8} movementSpeed={0.12} mouseInfluence={80} gravityStrength={35} /> : null}
      <PublicNavbar activePath="/public" />
      <section className="public-content">
        <header className="public-heading">
          <p className="eyebrow">CETP Community Board</p>
          <h1>Campus Confessions</h1>
          <p className="subcopy">A safe, anonymous space where CETP students speak their minds. Every confession is moderated and stays live for 60 days.</p>
        </header>
        <div className="notice" data-notice aria-live="polite" data-kind={hasError ? 'error' : undefined}>{notice}</div>
        <div className="public-message-list" id="public-message-list" aria-busy={loading || loadingMore}>
          {messages.length ? <HoverEffect
            items={messages}
            className="grid-cols-1 gap-6 py-0"
            itemClassName="public-message-card card-spotlight"
            onItemClick={(message) => onOpenMessage(message.id)}
            renderItem={(message) => (
              <Fragment>
              <div className="message-topline"><span className="public-label">Anonymous Confession{message.is_pinned ? ' · Pinned' : ''}</span><time>{formatRelativeTime(message.created_at)}</time></div>
              <p className="public-message-text">{message.public_message || 'Message with media attachment'}</p>
              {message.media_type?.startsWith('video/') && message.media_path ? <div className="media-preview media-placeholder">Video attachment</div> : null}
              {message.media_url ? <div className="media-preview"><img loading="lazy" src={message.media_url} alt="Approved confession attachment" /></div> : null}
              <div className="public-card-actions"><span className="secondary-button">Comments ({Number(message.comment_count) || 0})</span><span className="open-detail-label">Read and reply</span></div>
              </Fragment>
            )}
          /> : null}
          {!loading && !messages.length ? (
            <div className="empty-state public-empty"><h2>No confessions have been published yet.</h2><p>Be the first to share something anonymously.</p><a href={inboxUrl} className="primary-button">Send Anonymous Message</a></div>
          ) : null}
          {loading ? <div className="public-list-loading" aria-hidden="true"><LoaderOne /></div> : null}
        </div>
        {hasMore && !loading ? <button type="button" className="secondary-button load-more" onClick={loadMore} disabled={loadingMore}>Load more</button> : null}
      </section>
    </main>
  );
}
