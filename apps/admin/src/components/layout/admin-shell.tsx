'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { km } from '@workforce/contracts';
import { MotionStage } from '@/components/ui/motion-stage';
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
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  tab?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const mobileNavItems: NavItem[] = [
  { name: km.nav.operations, href: '/', icon: Activity },
  { name: km.nav.workers, href: '/workforce?tab=employees', tab: 'employees', icon: Users },
  { name: km.nav.sites, href: '/workforce?tab=projects-sites', tab: 'projects-sites', icon: Building },
  { name: km.nav.assignments, href: '/workforce?tab=assignments', tab: 'assignments', icon: Calendar },
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
    ],
  },
];

function AdminShellContent({ children }: { children: React.ReactNode }) {
  const { session, logout, isLoading } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab') || 'employees';
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, searchParams]);

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
    if (item.href === '/') return pathname === '/';
    if (item.href.startsWith('/workforce')) {
      return pathname === '/workforce' && currentTab === item.tab;
    }
    return pathname.startsWith(item.href);
  };

  return (
    <div className="app-stage min-h-screen bg-[#f2f6f4] text-slate-900 flex p-3 sm:p-4 gap-3 sm:gap-4 font-sans">
      <div className="app-stage__aurora" aria-hidden="true" />
      {/* Tossana Collapsible Sidebar Stage */}
      <aside
        className={`sticky top-3 sm:top-4 h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-2rem)] hidden shrink-0 flex-col gap-3 transition-[width] duration-300 ease-in-out md:flex z-30 ${
          collapsed ? 'w-[96px]' : 'w-[260px]'
        }`}
      >
        {/* Top Header Card inside Sidebar */}
        <div className="flex shrink-0 items-center h-16 px-4 rounded-[24px] border border-white/90 bg-white/80 shadow-xs backdrop-blur-xl justify-between">
          {!collapsed ? (
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#023F26] text-white shadow-xs">
                  <HardHat className="w-5 h-5 text-[#c4d701]" />
                </div>
                <div>
                  <div className="text-sm font-extrabold tracking-tight text-slate-900 leading-tight">
                    Workforce
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
              className="flex size-10 mx-auto items-center justify-center rounded-2xl border-2 border-white bg-[#023F26] text-white shadow-xs transition-all hover:scale-105 cursor-pointer"
              title="Expand navigation"
              aria-label="Expand navigation"
            >
              <Menu className="size-5 text-[#c4d701]" />
            </button>
          )}
        </div>

        {/* Navigation Block */}
        <div className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-white/90 bg-white/80 p-2 shadow-xs backdrop-blur-xl overflow-y-auto">
          <nav className="flex flex-1 flex-col gap-3 w-full">
            {navSections.map((section, idx) => (
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
                      href={item.href}
                      title={collapsed ? item.name : undefined}
                      className={`group flex items-center rounded-2xl border-2 font-semibold transition-all duration-200 ${
                        collapsed ? 'size-11 mx-auto justify-center px-0' : 'w-full h-10 gap-2.5 px-3'
                      } ${
                        active
                          ? 'border-white bg-[#023F26] text-white shadow-xs'
                          : 'border-transparent text-slate-600 hover:border-white/70 hover:bg-[#023F26]/6 hover:text-[#023F26]'
                      }`}
                    >
                      <Icon
                        className={`size-[17px] shrink-0 transition-colors ${
                          active ? 'text-[#c4d701]' : 'text-slate-500 group-hover:text-[#023F26]'
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
                    <div className="size-8 rounded-full bg-[#023F26] flex items-center justify-center text-[#c4d701] font-extrabold text-xs shrink-0 border border-white">
                      {session.user.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900 truncate">
                        {session.user.email.split('@')[0]}
                      </div>
                      <div className="text-[10px] font-bold text-[#023F26] truncate">
                        {session.organization.name}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={logout}
                    title="Sign Out"
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer shrink-0"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={logout}
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
        <header className="bg-white/80 border border-white/90 rounded-[24px] p-3.5 mb-4 shadow-xs backdrop-blur-xl flex items-center justify-between gap-2">
          {/* Left: Liquid Glass Mobile Trigger + Brand */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
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

            <div className="hidden md:flex items-center justify-center w-8 h-8 rounded-xl bg-[#023F26] text-white shrink-0">
              <HardHat className="w-4 h-4 text-[#c4d701]" />
            </div>

            <div className="min-w-0">
              <span className="text-xs font-extrabold text-slate-900 truncate block">Workforce Site Governance</span>
              <p className="text-[10px] font-bold text-slate-500 hidden sm:block">Asia/Phnom_Penh (UTC+7)</p>
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
              {mobileNavItems.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(item);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`group flex items-center rounded-2xl transition-all duration-200 w-full py-3.5 px-4 gap-3.5 text-[14px] ${
                      active
                        ? 'bg-white text-slate-950 font-bold shadow-[0_2px_12px_rgba(0,0,0,0.04)]'
                        : 'text-slate-600 hover:text-slate-950 font-medium active:bg-white/40 active:scale-[0.98]'
                    }`}
                  >
                    <Icon
                      className={`size-5 shrink-0 transition-colors ${
                        active ? 'text-[#023F26]' : 'text-slate-500 group-hover:text-slate-900'
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
                    logout();
                  }}
                  className="group flex items-center justify-between rounded-2xl w-full py-3 px-4 text-slate-600 hover:text-rose-600 hover:bg-white/60 transition-all active:scale-[0.98] cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="size-8 rounded-full bg-[#023F26] text-[#c4d701] font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                      {session.user.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {session.user.email.split('@')[0]}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {session.organization.name}
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
