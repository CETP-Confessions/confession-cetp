import React from 'react';
import { Sidebar, SidebarBody, SidebarLink } from '@/components/ui/sidebar.jsx';
import { PublicNavbar } from './PublicNavbar.jsx';
import { IconLayoutDashboard, IconMessage, IconPin, IconWorld, IconMessageDots, IconLogout } from '@tabler/icons-react';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient.jsx';

export function AdminSidebar({ activeSection, onSectionChange, onLogout }) {
  const links = [
    { label: "Dashboard", href: "#", icon: <IconLayoutDashboard className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />, onClick: (e) => { e.preventDefault(); onSectionChange('dashboard'); } },
    { label: "Messages", href: "#", icon: <IconMessage className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />, onClick: (e) => { e.preventDefault(); onSectionChange('inbox'); } },
    { label: "Pinned", href: "#", icon: <IconPin className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />, onClick: (e) => { e.preventDefault(); onSectionChange('pinned'); } },
    { label: "Public", href: "/public", icon: <IconWorld className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" /> },
    { label: "Comments", href: "#", icon: <IconMessageDots className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />, onClick: (e) => { e.preventDefault(); onSectionChange('comments'); } },
    { label: "Logout", href: "#", icon: <IconLogout className="text-neutral-700 dark:text-neutral-200 h-5 w-5 shrink-0" />, onClick: (e) => { e.preventDefault(); onLogout(); } },
  ];

  return (
    <Sidebar>
      <SidebarBody className="justify-between gap-10">
        <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
          <a href="/" className="brand dashboard-brand flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm mb-8">
            <img src="/logo.jpg" className="brand-logo h-12 w-12 rounded-xl object-cover" alt="logo" />
            <span><strong>CETP Confessions</strong><br/><small>Admin workspace</small></span>
          </a>
          <div className="flex flex-col gap-2">
            {links.map((link, idx) => (
              <div key={idx} onClick={link.onClick}>
                <SidebarLink link={link} />
              </div>
            ))}
          </div>
        </div>
      </SidebarBody>
    </Sidebar>
  );
}

export function NavbarTabs({ activePath }) {
  return <PublicNavbar activePath={activePath} />;
}

export function GradientButton({ children, onClick, type = "button", className = "" }) {
  return (
    <HoverBorderGradient as="button" type={type} onClick={onClick} className={className}>
      {children}
    </HoverBorderGradient>
  );
}

import { createRoot } from 'react-dom/client';

export function mountSidebar(element, props) {
  const root = createRoot(element);
  root.render(<AdminSidebar {...props} />);
  return root;
}

export function mountNavbar(element, props) {
  const root = createRoot(element);
  root.render(<NavbarTabs {...props} />);
  return root;
}

export function mountGradientButton(element, props) {
  const root = createRoot(element);
  root.render(<GradientButton {...props} />);
  return root;
}

