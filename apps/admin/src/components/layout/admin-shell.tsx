'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { km } from '@workforce/contracts';
import { MotionStage } from '@/components/ui/motion-stage';
import { ConfirmActionDialog } from '@/components/ui/action-state';
import { adminApi, getStoredSession } from '@/lib/api';
import { PORTAL_BRANDING_UPDATED, publishPortalBranding, readPortalBranding, type PortalBranding } from '@/lib/portal-branding';
import {
  Activity,
  AlertCircle,
  Users,
  Briefcase,
  Layers,
  UserCheck,
  Building,
  Calendar,
  BarChart3,
  ShieldCheck,
  LogOut,
  HardHat,
  ChevronLeft,
  Menu,
  MoreVertical,
  X,
  LayoutGrid,
  List,
  Send,
  Globe,
} from 'lucide-react';
import { useLocale } from '@/lib/locale-context';

interface NavItem {
  name: string;
  href: string;
  tab?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const mobileNavItems: NavItem[] = [
  { name: km.nav.operations, href: '/', icon: Activity },
  { name: km.nav.attendance, href: '/attendance', icon: UserCheck },
  { name: km.nav.sales, href: '/sales', icon: Briefcase },
  { name: km.nav.workers, href: '/workforce?tab=employees', tab: 'employees', icon: Users },
  { name: km.nav.sites, href: '/workforce?tab=projects-sites', tab: 'projects-sites', icon: Building },
  { name: km.nav.assignments, href: '/workforce?tab=assignments', tab: 'assignments', icon: Calendar },
  { name: km.nav.telegramReporting, href: '/telegram-reporting', icon: Send },
];

interface NavSection {
  title?: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  { title: km.nav.operations, items: [{ name: km.nav.operations, href: '/', icon: Activity }] },
  {
    title: km.nav.management,
    items: [
      { name: km.nav.workers, href: '/workforce?tab=employees', tab: 'employees', icon: Users },
      { name: km.nav.sites, href: '/workforce?tab=projects-sites', tab: 'projects-sites', icon: Building },
      { name: km.nav.assignments, href: '/workforce?tab=assignments', tab: 'assignments', icon: Calendar },
      { name: km.nav.telegramReporting, href: '/telegram-reporting', icon: Send },
      { name: km.nav.attendance, href: '/attendance', icon: UserCheck },
      { name: km.nav.sales, href: '/sales', icon: Briefcase },
      { name: km.nav.reports, href: '/reports', icon: BarChart3 },
      { name: km.nav.security, href: '/security', icon: ShieldCheck },
      { name: km.nav.settings, href: '/settings', icon: Layers },
    ],
  },
];

function AdminShellContent({ children }: { children: React.ReactNode }) {
  const { session, logout, isLoading } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const organizationPath = session ? `/${session.organization.slug}` : '';
  const workspacePathname = organizationPath && (pathname === organizationPath || pathname.startsWith(`${organizationPath}/`))
    ? pathname.slice(organizationPath.length) || '/'
    : pathname;
  const workspaceHref = (href: string) => organizationPath ? `${organizationPath}${href === '/' ? '' : href}` : href;
  const currentTab = searchParams.get('tab') || 'employees';
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  // Keep the server and initial client tree identical. Tenant branding is
  // loaded after hydration from local storage/API, never during render.
  const [portalSettings, setPortalSettings] = useState<PortalBranding | null>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    // The shell persists across the login route. Never carry a previously
    // confirmed sign-out dialog into a later authenticated session.
    if (!session) setSignOutDialogOpen(false);
  }, [session]);

  React.useEffect(() => {
    if (!session) return;
    const cached = readPortalBranding(session.organization.id);
    if (cached) setPortalSettings(cached);
    adminApi.getSettings().then((branding) => {
      if (branding.id !== session.organization.id) return;
      setPortalSettings(branding);
      publishPortalBranding(branding);
    }).catch(() => undefined);
  }, [session]);

  React.useEffect(() => {
    const handleBrandingUpdate = (event: Event) => {
      const branding = (event as CustomEvent<PortalBranding>).detail;
      if (branding.id === session?.organization.id) setPortalSettings(branding);
    };
    window.addEventListener(PORTAL_BRANDING_UPDATED, handleBrandingUpdate);
    return () => window.removeEventListener(PORTAL_BRANDING_UPDATED, handleBrandingUpdate);
  }, [session?.organization.id]);

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, searchParams]);

  React.useEffect(() => {
    if (!session || pathname === '/login') return;
    if (pathname === organizationPath || pathname.startsWith(`${organizationPath}/`)) return;

    const internalRoots = new Set(['attendance', 'workforce', 'sales', 'reports', 'security', 'settings', 'telegram-reporting', 'employees', 'projects']);
    const segments = pathname.split('/').filter(Boolean);
    const destinationPath = segments[0] && !internalRoots.has(segments[0])
      ? `/${segments.slice(1).join('/')}`
      : pathname;
    const query = searchParams.toString();
    router.replace(`${organizationPath}${destinationPath === '/' ? '' : destinationPath}${query ? `?${query}` : ''}`);
  }, [organizationPath, pathname, router, searchParams, session]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--portal-primary', portalSettings?.brandPrimaryColor ?? '#023F26');
    root.style.setProperty('--portal-accent', portalSettings?.brandAccentColor ?? '#c4d701');
  }, [portalSettings?.brandAccentColor, portalSettings?.brandPrimaryColor]);

  const activeNavSections: NavSection[] = React.useMemo(() => [
    { title: t.nav.operations, items: [{ name: t.nav.operations, href: '/', icon: Activity }] },
    {
      title: t.nav.management,
      items: [
        { name: t.nav.workers, href: '/workforce?tab=employees', tab: 'employees', icon: Users },
        { name: t.nav.sites, href: '/workforce?tab=projects-sites', tab: 'projects-sites', icon: Building },
        { name: t.nav.assignments, href: '/workforce?tab=assignments', tab: 'assignments', icon: Calendar },
        { name: t.nav.telegramReporting, href: '/telegram-reporting', icon: Send },
        { name: t.nav.attendance, href: '/attendance', icon: UserCheck },
        { name: t.nav.sales, href: '/sales', icon: Briefcase },
        { name: t.nav.reports, href: '/reports', icon: BarChart3 },
        { name: t.nav.security, href: '/security', icon: ShieldCheck },
        { name: t.nav.settings, href: '/settings', icon: Layers },
      ],
    },
  ], [t.nav]);

  const activeMobileNavItems: NavItem[] = React.useMemo(() => [
    { name: t.nav.operations, href: '/', icon: Activity },
    { name: t.nav.attendance, href: '/attendance', icon: UserCheck },
    { name: t.nav.sales, href: '/sales', icon: Briefcase },
    { name: t.nav.workers, href: '/workforce?tab=employees', tab: 'employees', icon: Users },
    { name: t.nav.sites, href: '/workforce?tab=projects-sites', tab: 'projects-sites', icon: Building },
    { name: t.nav.assignments, href: '/workforce?tab=assignments', tab: 'assignments', icon: Calendar },
    { name: t.nav.telegramReporting, href: '/telegram-reporting', icon: Send },
  ], [t.nav]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f2f6f4] flex items-center justify-center text-slate-700 font-sans">
        <div className="flex items-center space-x-3 bg-white/80 p-4 rounded-2xl border border-white shadow-md backdrop-blur-xl">
          <div className="w-5 h-5 border-2 border-[#023F26] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold text-[#023F26]">{km.app.loading}</span>
        </div>
      </div>
    );
  }

  const isItemActive = (item: NavItem) => {
    if (item.href === '/') return workspacePathname === '/';
    if (item.href.startsWith('/workforce')) {
      return workspacePathname === '/workforce' && currentTab === item.tab;
    }
    return workspacePathname.startsWith(item.href);
  };

  const confirmSignOut = () => {
    setSignOutDialogOpen(false);
    logout();
  };

  return (
    <div className="app-stage min-h-screen bg-[#f2f6f4] text-slate-900 flex p-3 sm:p-4 gap-3 sm:gap-4 font-sans" style={{ '--portal-primary': portalSettings?.brandPrimaryColor ?? '#023F26', '--portal-accent': portalSettings?.brandAccentColor ?? '#c4d701' } as React.CSSProperties}>
      <div className="app-stage__aurora" aria-hidden="true" />
      {/* Tossana Collapsible Sidebar Stage */}
      <aside
        className={`sticky top-3 sm:top-4 h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-2rem)] hidden shrink-0 flex-col gap-4 transition-[width] duration-300 ease-in-out md:flex z-30 ${
          collapsed ? 'w-[96px]' : 'w-[260px]'
        }`}
      >
        {/* Top Header Card inside Sidebar */}
        <div className="flex h-[68px] shrink-0 items-center justify-between rounded-[24px] border border-white/90 bg-white/80 px-4 shadow-xs backdrop-blur-xl">
          {!collapsed ? (
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <BrandMark logoUrl={portalSettings?.logoUrl} className="flex size-10 rounded-xl" />
                <div>
                  <div className="text-sm font-extrabold text-slate-900 leading-tight">
                    {portalSettings?.name ?? session?.organization.name ?? 'Workforce'}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500">Site Governance</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
                aria-label="Collapse navigation"
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex size-10 mx-auto items-center justify-center overflow-hidden rounded-2xl border-2 border-white bg-[var(--portal-primary)] text-white shadow-xs transition-all hover:scale-105 cursor-pointer"
              title="Expand navigation"
              aria-label="Expand navigation"
            >
              {portalSettings?.logoUrl ? <img src={portalSettings.logoUrl} alt={km.admin.companyLogo} className="size-full scale-150 bg-white object-contain" /> : <Menu className="size-5 text-[var(--portal-accent)]" />}
            </button>
          )}
        </div>

        {/* Navigation Block */}
        <div className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-white/90 bg-white/80 p-2 shadow-xs backdrop-blur-xl overflow-y-auto">
          <nav className="flex flex-1 flex-col gap-3 w-full">
            {activeNavSections.map((section, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                {!collapsed && section.title ? (
                  <p className="px-3 pb-1 pt-1.5 text-[11px] font-extrabold text-black">
                    {section.title}
                  </p>
                ) : null}

                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(item);

                  return (
                    <Link
                      key={item.name}
                      href={workspaceHref(item.href)}
                      title={collapsed ? item.name : undefined}
                      className={`group flex items-center rounded-2xl border-2 font-semibold transition-all duration-200 ${
                        collapsed ? 'size-11 mx-auto justify-center px-0' : 'w-full h-10 gap-2.5 px-3'
                      } ${
                        active
                          ? 'border-white bg-[var(--portal-primary)] text-white shadow-xs'
                          : 'border-transparent text-slate-600 hover:border-white/70 hover:bg-slate-50 hover:text-[var(--portal-primary)]'
                      }`}
                    >
                      <Icon
                        className={`size-[17px] shrink-0 transition-colors ${
                          active ? 'text-[var(--portal-accent)]' : 'text-slate-500 group-hover:text-[var(--portal-primary)]'
                        }`}
                        strokeWidth={active ? 2.4 : 2}
                      />
                      {!collapsed ? <span className="truncate text-xs font-bold">{item.name}</span> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom Profile Summary Card in Sidebar */}
        <div className="flex shrink-0 items-center p-3 rounded-[24px] border border-white/90 bg-white/80 shadow-xs backdrop-blur-xl">
          {mounted && session && (
            <div className="flex items-center justify-between w-full">
              {!collapsed ? (
                <>
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div className="size-8 rounded-full bg-[var(--portal-primary)] flex items-center justify-center text-[var(--portal-accent)] font-extrabold text-xs shrink-0 border border-white">
                      {session.user.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900 truncate">
                        {session.user.email.split('@')[0]}
                      </div>
                      <div className="text-[10px] font-bold text-[var(--portal-primary)] truncate">
                        {portalSettings?.name ?? session.organization.name}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSignOutDialogOpen(true)}
                    title="Sign Out"
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer shrink-0"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setSignOutDialogOpen(true)}
                  title="Sign Out"
                  className="p-1.5 mx-auto text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer shrink-0"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main App Stage Container */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/* Topbar Bar Card */}
        <header className="flex h-[68px] items-center justify-between gap-2 rounded-[24px] border border-white/90 bg-white/80 px-4 py-[13px] shadow-xs backdrop-blur-xl mb-4">
          {/* Left: Liquid Glass Mobile Trigger + Brand */}
          <div className="flex min-w-0 items-center space-x-2.5">
            {/* Mobile Hamburger Liquid Glass Trigger on the LEFT */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/95 hover:bg-white text-slate-800 border border-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl transition-all active:scale-95 cursor-pointer"
              aria-label="Open menu"
              title="Menu"
            >
              <Menu className="size-5 text-slate-800" strokeWidth={2.4} />
            </button>

            <BrandMark logoUrl={portalSettings?.logoUrl} className="hidden size-10 rounded-xl md:flex" />

            <div className="min-w-0">
              <span className="block text-sm font-extrabold leading-tight text-slate-900">{portalSettings?.name ?? session?.organization.name ?? 'Workforce'}</span>
              <p className="text-[10px] font-bold text-slate-500 hidden sm:block">Asia/Phnom_Penh (UTC+7)</p>
            </div>
          </div>

          {/* Right: Language / Translate Switcher (KM 🇰🇭 / EN 🇬🇧) */}
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="inline-flex items-center gap-1 rounded-2xl border border-slate-200/90 bg-white/90 p-1 shadow-2xs backdrop-blur-md"
              title={locale === 'km' ? 'ប្តូរភាសាទៅ English' : 'Switch to Khmer language'}
              role="group"
              aria-label="Language switcher"
            >
              <div className="hidden sm:flex items-center pl-2 pr-0.5 text-slate-400">
                <Globe className="size-3.5" />
              </div>
              <button
                type="button"
                onClick={() => setLocale('km')}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  locale === 'km'
                    ? 'bg-[var(--portal-primary)] text-white shadow-xs font-black'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
                }`}
              >
                <span className="text-xs">🇰🇭</span>
                <span>ខ្មែរ</span>
              </button>
              <button
                type="button"
                onClick={() => setLocale('en')}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  locale === 'en'
                    ? 'bg-[var(--portal-primary)] text-white shadow-xs font-black'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
                }`}
              >
                <span className="text-xs">🇬🇧</span>
                <span>EN</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area Canvas */}
        <main className="flex-1 min-h-0 max-w-full overflow-x-hidden bg-white/90 border border-white/90 rounded-[28px] p-3.5 sm:p-6 shadow-sm">
          <MotionStage>{children}</MotionStage>
        </main>
      </div>

      {/* Apple Liquid Glass Deep Frosted Mobile Navigation Drawer (Slides from the LEFT) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex justify-start">
          {/* Translucent Frosted Backdrop */}
          <div
            className="fixed inset-0 bg-black/25 backdrop-blur-xl backdrop-saturate-150 transition-opacity duration-300 animate-in fade-in"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Liquid Glass Deep Frozen Panel (Rounded right edge, slide in from LEFT, no scrollbar) */}
          <div className="relative w-[80%] max-w-[310px] h-full bg-white/80 backdrop-blur-3xl backdrop-saturate-180 border-r border-white/70 rounded-r-[36px] pt-6 px-4 pb-6 flex flex-col gap-4 z-10 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden animate-in slide-in-from-left duration-300 ease-out shadow-[0_20px_50px_rgba(0,0,0,0.16)]">
            {/* Top Controls matching exact reference design */}
            <div className="flex shrink-0 items-center justify-between px-0.5">
              {/* Segmented Pill Capsule matching reference */}
              <div className="bg-black/[0.04] p-1 rounded-2xl flex items-center gap-1 backdrop-blur-md">
                <div className="p-1.5 text-slate-400 rounded-xl">
                  <LayoutGrid className="size-4" />
                </div>
                <div className="bg-white rounded-xl shadow-2xs py-1 px-3 flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <List className="size-3.5 text-slate-700" />
                  <span>Menu</span>
                </div>
              </div>

              {/* Translucent Circular Close Button matching reference */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="size-9 rounded-full bg-black/[0.05] hover:bg-black/[0.08] text-slate-700 flex items-center justify-center backdrop-blur-md transition-all active:scale-90 cursor-pointer"
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Navigation Items (Clean Apple style, spacious, NO harsh headers) */}
            <nav className="flex flex-1 flex-col gap-1 w-full mt-1">
              {activeMobileNavItems.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(item);

                return (
                  <Link
                    key={item.name}
                    href={workspaceHref(item.href)}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`group flex items-center rounded-2xl transition-all duration-200 w-full py-3.5 px-4 gap-3.5 text-[14px] ${
                      active
                        ? 'bg-white text-slate-950 font-bold shadow-[0_2px_12px_rgba(0,0,0,0.04)]'
                        : 'text-slate-600 hover:text-slate-950 font-medium active:bg-white/40 active:scale-[0.98]'
                    }`}
                  >
                    <Icon
                      className={`size-5 shrink-0 transition-colors ${
                        active ? 'text-[var(--portal-primary)]' : 'text-slate-500 group-hover:text-slate-900'
                      }`}
                      strokeWidth={active ? 2.4 : 2}
                    />
                    <span className="truncate">{item.name}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Account / Sign Out item at the bottom matching reference */}
            {mounted && session && (
              <div className="mt-auto pt-2 border-t border-black/[0.04]">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setSignOutDialogOpen(true);
                  }}
                  className="group flex items-center justify-between rounded-2xl w-full py-3 px-4 text-slate-600 hover:text-rose-600 hover:bg-white/60 transition-all active:scale-[0.98] cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="size-8 rounded-full bg-[var(--portal-primary)] text-[var(--portal-accent)] font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                      {session.user.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {session.user.email.split('@')[0]}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {portalSettings?.name ?? session.organization.name}
                      </div>
                    </div>
                  </div>
                  <LogOut className="size-4 text-slate-400 group-hover:text-rose-600 shrink-0" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmActionDialog
        open={signOutDialogOpen}
        title={km.auth.confirmSignOutTitle}
        description={km.auth.confirmSignOutDescription}
        confirmLabel={km.auth.signOut}
        destructive
        onCancel={() => setSignOutDialogOpen(false)}
        onConfirm={confirmSignOut}
      />
    </div>
  );
}

function BrandMark({ logoUrl, className }: { logoUrl?: string | null; className: string }) {
  return (
    <div className={`${className} shrink-0 items-center justify-center overflow-hidden bg-[var(--portal-primary)] text-white shadow-xs`}>
      {logoUrl ? (
        <img src={logoUrl} alt={km.admin.companyLogo} className="size-full scale-150 bg-white object-contain" />
      ) : (
        <HardHat className="size-1/2 text-[var(--portal-accent)]" />
      )}
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f2f6f4] flex items-center justify-center text-slate-700 font-sans">
          <div className="flex items-center space-x-3 bg-white/80 p-4 rounded-2xl border border-white shadow-md backdrop-blur-xl">
            <div className="w-5 h-5 border-2 border-[#023F26] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-bold text-[#023F26]">Loading portal environment...</span>
          </div>
        </div>
      }
    >
      <AdminShellContent>{children}</AdminShellContent>
    </Suspense>
  );
}
