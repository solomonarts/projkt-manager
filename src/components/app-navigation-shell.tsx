'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  FileBarChart2, FileText, Flag, FolderKanban, LayoutDashboard, ListTodo,
  ShieldCheck, Target, Users, WalletCards, MoreHorizontal,
} from 'lucide-react';
import { signOut } from '@/app/auth-actions';

type NavigationData = {
  profile: { name: string; role: string };
  permissions: Record<string, boolean>;
  pendingCounts?: Record<string, number>;
};

const groups = [
  { label: 'WORKSPACE', items: [
    { label: 'Overview', href: '/', icon: LayoutDashboard, permission: 'dashboard' },
    { label: 'Projects', href: '/projects', icon: FolderKanban, permission: 'projects' },
    { label: 'Tasks & Activities', href: '/tasks', icon: ListTodo, permission: 'tasks', pending: 'tasks' },
    { label: 'Teams & Members', href: '/teams#registration-approvals', icon: Users, permission: 'teams', pending: 'teams' },
  ] },
  { label: 'INSIGHTS', items: [
    { label: 'Reports', href: '/reports', icon: FileBarChart2, permission: 'reports', pending: 'reports' },
    { label: 'MEAL & Evaluation', href: '/meal', icon: Target, permission: 'meal' },
    { label: 'Risks & Issues', href: '/meal#risks', icon: Flag, permission: 'risks' },
  ] },
  { label: 'ORGANIZATION', items: [
    { label: 'Accounting & Reporting', href: '/accounting', icon: WalletCards, permission: 'accounting', pending: 'accounting' },
    { label: 'Documents', href: '/documents', icon: FileText, permission: 'documents' },
    { label: 'Administration & Permissions', href: '/admin', icon: ShieldCheck, permission: 'administration' },
  ] },
];

const publicPaths = ['/login', '/signup', '/reset-password', '/update-password'];

export default function AppNavigationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const [navigation, setNavigation] = useState<NavigationData | null>(null);
  const [hash, setHash] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isAuthPage = publicPaths.includes(pathname);

  useEffect(() => {
    if (isAuthPage) return;
    let active = true;
    fetch('/api/navigation').then(async response => {
      if (!response.ok) throw new Error('Navigation is unavailable.');
      return response.json() as Promise<NavigationData>;
    }).then(data => { if (active) setNavigation(data); })
      .catch(() => { if (active) setNavigation(null); });
    return () => { active = false; };
  }, [isAuthPage, pathname]);

  useEffect(() => {
    const updateHash = () => { setHash(window.location.hash); setMobileMenuOpen(false); };
    updateHash();
    window.addEventListener('hashchange', updateHash);
    return () => window.removeEventListener('hashchange', updateHash);
  }, [pathname]);

  useEffect(() => {
    const addMobileLabels = () => {
      document.querySelectorAll<HTMLTableElement>('.workspace-table, .project-table').forEach(table => {
        const headings = Array.from(table.querySelectorAll('thead th')).map(heading => heading.textContent?.trim() ?? '');
        table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(row => {
          Array.from(row.cells).forEach((cell, index) => {
            if (headings[index]) cell.setAttribute('data-label', headings[index]);
          });
        });
      });
    };
    addMobileLabels();
    const observer = new MutationObserver(addMobileLabels);
    observer.observe(document.getElementById('main-content') ?? document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);

  if (isAuthPage) return <>{children}</>;

  const allItems = groups.flatMap(group => group.items).filter(item => navigation?.permissions[item.permission]);
  const mobilePriority = ['/', '/projects', '/tasks', '/reports', '/meal'];
  const mobileItems = mobilePriority.map(path => allItems.find(item => item.href.split('#')[0] === path)).filter((item): item is typeof allItems[number] => !!item).slice(0, 4);
  const mobileMoreItems = allItems.filter(item => !mobileItems.includes(item));

  return <div className="global-app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar global-sidebar" aria-label="Main navigation">
      <a className="brand" href="/" aria-label="Fieldnote overview">
        <span className="brand-icon"><span/><span/><span/><span/></span>
        <span className="brand-name">fieldnote<span className="brand-dot">.</span></span>
      </a>
      <div className="org-switcher" aria-label="Organization workspace">
        <span className="org-mark">F</span>
        <span className="org-copy"><b>Organization workspace</b><small>Management</small></span>
      </div>
      <div className="side-scroll">
        {groups.map(group => {
          const items = group.items.filter(item => navigation?.permissions[item.permission]);
          return items.length ? <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {items.map(({ label, href, icon: Icon, pending }) => {
              const pendingCount = pending ? navigation?.pendingCounts?.[pending] ?? 0 : 0;
              const targetPath = href.split('#')[0];
              const selected = targetPath === '/meal'
                ? pathname === '/meal' && ((href.includes('#risks') && hash === '#risks') || (!href.includes('#') && hash !== '#risks'))
                : pathname === targetPath || (targetPath !== '/' && pathname.startsWith(`${targetPath}/`));
              return <a key={label} href={href} title={pendingCount ? `${label}: ${pendingCount} pending actions` : label} aria-label={pendingCount ? `${label}, ${pendingCount} pending actions` : label} aria-current={selected ? 'page' : undefined} className={`nav-item ${selected ? 'selected' : ''}`}>
                <Icon size={17} strokeWidth={1.8}/><span>{label}</span>{pendingCount > 0 && <small className="nav-badge" aria-hidden="true">{pendingCount > 99 ? '99+' : pendingCount}</small>}
              </a>;
            })}
          </div> : null;
        })}
      </div>
      <div className="sidebar-bottom">
        <div className="profile-card">
          <span className="avatar avatar-profile">{navigation?.profile.name.slice(0, 2).toUpperCase() || '—'}</span>
          <span className="profile-copy"><b>{navigation?.profile.name || 'Loading account…'}</b><small>{navigation?.profile.role || 'Organization member'}</small></span>
          <form action={signOut}><button className="profile-signout" type="submit">Sign out</button></form>
        </div>
      </div>
    </aside>
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {mobileItems.map(({label,href,icon:Icon}) => <a key={label} href={href} aria-current={pathname===href|| (href!=='/'&&pathname.startsWith(`${href}/`))?'page':undefined}>
        <Icon size={19} strokeWidth={1.8}/><span>{label==='Tasks & Activities'?'Tasks':label==='MEAL & Evaluation'?'MEAL':label}</span>
      </a>)}
      <button type="button" aria-expanded={mobileMenuOpen} aria-controls="mobile-more-menu" onClick={()=>setMobileMenuOpen(value=>!value)}><MoreHorizontal size={20}/><span>More</span></button>
    </nav>
    {mobileMenuOpen&&<div className="mobile-more-menu" id="mobile-more-menu">
      {mobileMoreItems.map(({label,href,icon:Icon})=><a key={label} href={href}><Icon size={17}/>{label}</a>)}
      <form action={signOut}><button type="submit">Sign out</button></form>
    </div>}
    <div className="global-app-main" id="main-content">{children}</div>
  </div>;
}
