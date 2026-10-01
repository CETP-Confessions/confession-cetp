export function PublicNavbar({ activePath = '/' }) {
  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/public', label: 'Public Confessions' },
    { href: '/admin/login', label: 'Admin Login' },
  ];

  return (
    <nav className="top-nav public-nav" aria-label="Public navigation">
      <div className="top-nav-inner">
        <a href="/" className="brand" aria-label="CETP Confessions home">
          <img src="/logo.jpg" className="brand-logo" alt="" />
          <span>CETP Confessions</span>
        </a>

        <button
          className="menu-toggle"
          type="button"
          aria-expanded="false"
          aria-controls="public-nav-links"
          aria-label="Open navigation menu"
          data-action="toggle-nav"
        >
          <span></span><span></span><span></span>
        </button>

        <div className="nav-actions" id="public-nav-links">
          {navItems.map((item) => {
            const isActive = item.href === activePath;
            return (
              <a
                key={item.href}
                href={item.href}
                className={isActive ? 'nav-link active' : 'nav-link'}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </a>
            );
          })}
          <a href="/message/admin" className="primary-link nav-cta">
            Send Anonymous Message
          </a>
        </div>
      </div>
    </nav>
  );
}
