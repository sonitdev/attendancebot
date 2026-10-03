'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, Link, LoaderCircle, ShieldCheck } from 'lucide-react';
import { km, type ProjectListItem, type SiteListItem } from '@workforce/contracts';
import { adminApi, getStoredSession, type AdminAccessScopeUser } from '@/lib/api';
import { ActionStatus, ConfirmActionDialog, type ActionFeedback, useUnsavedChanges } from '@/components/ui/action-state';
import { publishPortalBranding } from '@/lib/portal-branding';

const settingsSignature = (value: any) => JSON.stringify({
  name: value?.name ?? '',
  brandPrimaryColor: value?.brandPrimaryColor ?? '',
  brandAccentColor: value?.brandAccentColor ?? '',
  defaultLocale: value?.defaultLocale ?? '',
});

const scopeSignature = (user: AdminAccessScopeUser) => JSON.stringify({
  projectIds: user.projects.map((item) => item.id).sort(),
  siteIds: user.sites.map((item) => item.id).sort(),
});

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [scopeUsers, setScopeUsers] = useState<AdminAccessScopeUser[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [savedSettingsSignature, setSavedSettingsSignature] = useState('');
  const [savedScopeSignatures, setSavedScopeSignatures] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<ActionFeedback>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [savingScopeUserId, setSavingScopeUserId] = useState<string | null>(null);
  const [confirmSettings, setConfirmSettings] = useState(false);
  const [confirmScopeUser, setConfirmScopeUser] = useState<AdminAccessScopeUser | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [isCreatingPairing, setIsCreatingPairing] = useState(false);
  const roles = getStoredSession()?.user.roles ?? [];
  const canManageScopes = roles.includes('OWNER') || roles.includes('HR');
  const settingsDirty = Boolean(settings) && settingsSignature(settings) !== savedSettingsSignature;
  const anyScopeDirty = scopeUsers.some((user) => savedScopeSignatures[user.id] !== scopeSignature(user));
  useUnsavedChanges(settingsDirty || anyScopeDirty);

  const load = async () => {
    try {
      const [nextSettings, nextProjects, nextSites] = await Promise.all([
        adminApi.getSettings(),
        adminApi.listProjects(),
        adminApi.listSites(),
      ]);
      setSettings(nextSettings);
      publishPortalBranding(nextSettings);
      setSavedSettingsSignature(settingsSignature(nextSettings));
      setProjects(nextProjects);
      setSites(nextSites);
      if (canManageScopes) {
        const users = await adminApi.listAdminAccessScopes();
        setScopeUsers(users);
        setSavedScopeSignatures(Object.fromEntries(users.map((user) => [user.id, scopeSignature(user)])));
      }
      setFeedback(null);
    } catch (reason: any) {
      setFeedback({ type: 'error', message: reason.message || km.actions.saveFailed });
    }
  };

  useEffect(() => { void load(); }, []);

  const upload = (file?: File) => {
    if (!file) return;
    setIsUploading(true);
    setFeedback({ type: 'info', message: km.actions.uploading });
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await adminApi.uploadLogo(String(reader.result));
        setSettings((current: any) => {
          const next = { ...current, logoUrl: result.logoUrl };
          publishPortalBranding(next);
          return next;
        });
        setFeedback({ type: 'success', message: km.actions.uploaded });
      } catch (reason: any) {
        setFeedback({ type: 'error', message: reason.message || km.actions.saveFailed });
      } finally {
        setIsUploading(false);
      }
    };
    reader.onerror = () => {
      setIsUploading(false);
      setFeedback({ type: 'error', message: km.actions.saveFailed });
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!settingsDirty || isSaving) return;
    setIsSaving(true);
    setFeedback({ type: 'info', message: km.actions.saving });
    try {
      await adminApi.updateSettings({
        name: settings.name,
        brandPrimaryColor: settings.brandPrimaryColor,
        brandAccentColor: settings.brandAccentColor,
        defaultLocale: settings.defaultLocale,
      });
      const authoritative = await adminApi.getSettings();
      setSettings(authoritative);
      publishPortalBranding(authoritative);
      setSavedSettingsSignature(settingsSignature(authoritative));
      setConfirmSettings(false);
      setFeedback({ type: 'success', message: km.actions.saved });
    } catch (reason: any) {
      setFeedback({ type: 'error', message: reason.message || km.actions.saveFailed });
    } finally {
      setIsSaving(false);
    }
  };

  const requestSettingsSave = () => {
    if (isSaving) return;
    if (!settingsDirty) {
      setFeedback({ type: 'success', message: km.actions.noChanges });
      return;
    }
    setConfirmSettings(true);
  };

  const createOwnerPairing = async () => {
    setIsCreatingPairing(true);
    try {
      const result = await adminApi.createTelegramOwnerPairing();
      setPairingUrl(result.url);
    } catch (reason: any) {
      setFeedback({ type: 'error', message: reason.message || km.actions.saveFailed });
    } finally {
      setIsCreatingPairing(false);
    }
  };

  const toggleScope = (userId: string, kind: 'projects' | 'sites', item: any) => {
    setScopeUsers((users) => users.map((user) => {
      if (user.id !== userId) return user;
      const selected = user[kind].some((current) => current.id === item.id);
      return { ...user, [kind]: selected ? user[kind].filter((current) => current.id !== item.id) : [...user[kind], item] };
    }));
  };

  const saveScope = async (user: AdminAccessScopeUser) => {
    if (savingScopeUserId) return;
    setSavingScopeUserId(user.id);
    setFeedback({ type: 'info', message: km.actions.saving });
    try {
      await adminApi.replaceAdminAccessScopes(user.id, {
        projectIds: user.projects.map((project) => project.id),
        siteIds: user.sites.map((site) => site.id),
      });
      const authoritativeUsers = await adminApi.listAdminAccessScopes();
      setScopeUsers(authoritativeUsers);
      setSavedScopeSignatures(Object.fromEntries(authoritativeUsers.map((item) => [item.id, scopeSignature(item)])));
      setConfirmScopeUser(null);
      setFeedback({ type: 'success', message: km.actions.accessSaved });
    } catch (reason: any) {
      setFeedback({ type: 'error', message: reason.message || km.actions.saveFailed });
    } finally {
      setSavingScopeUserId(null);
    }
  };

  if (!settings) return <main className="p-6 text-slate-500">{km.admin.loading}</main>;

  return (
    <main className="space-y-6">
      <header>
        <p className="text-[11px] font-black uppercase text-[var(--portal-primary)]">{km.admin.interfaceSettings}</p>
        <h1 className="mt-2 text-3xl font-black">{km.admin.settingsTitle}</h1>
        <p className="mt-2 text-sm text-slate-600">{km.admin.settingsSubtitle}</p>
      </header>
      <ActionStatus feedback={feedback} />

      <section className="grid gap-8 rounded-[30px] border border-slate-200 bg-white p-6 lg:grid-cols-[260px_1fr]">
        <label title={km.admin.changeLogo} className={`group relative grid aspect-square place-items-center overflow-hidden rounded-[28px] border-2 border-dashed border-slate-200 bg-slate-50 ${isUploading ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}>
          {settings.logoUrl ? <img src={settings.logoUrl} alt={km.admin.companyLogo} className="h-full w-full object-contain p-8"/> : <div className="text-center text-slate-500"><ImagePlus className="mx-auto"/><p className="mt-2 text-sm font-bold">{km.admin.companyLogo}</p></div>}
          {!isUploading && <span className="absolute bottom-3 rounded-lg bg-[var(--portal-primary)] px-3 py-1.5 text-xs font-black text-white shadow-sm">{km.admin.changeLogo}</span>}
          {isUploading && <span className="absolute inset-0 grid place-items-center bg-white/75"><LoaderCircle className="size-7 animate-spin text-emerald-800"/></span>}
          <input disabled={isUploading} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(event) => upload(event.target.files?.[0])}/>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={km.admin.companyName}><input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })}/></Field>
          <Field label={km.admin.language}><select value={settings.defaultLocale} onChange={(event) => setSettings({ ...settings, defaultLocale: event.target.value })}><option value="km">{km.admin.localeKhmer}</option><option value="en">{km.admin.localeEnglish}</option></select></Field>
          <Field label={km.admin.primaryColor}><input type="color" value={settings.brandPrimaryColor} onChange={(event) => setSettings({ ...settings, brandPrimaryColor: event.target.value })}/></Field>
          <Field label={km.admin.accentColor}><input type="color" value={settings.brandAccentColor} onChange={(event) => setSettings({ ...settings, brandAccentColor: event.target.value })}/></Field>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
            <p className={`text-xs font-bold ${settingsDirty ? 'text-amber-700' : 'text-slate-400'}`}>{settingsDirty ? km.actions.unsavedChanges : km.actions.noChanges}</p>
            <button disabled={isSaving} onClick={requestSettingsSave} className="rounded-xl bg-[var(--portal-primary)] px-5 py-3 font-black text-white transition hover:brightness-90 disabled:cursor-wait disabled:opacity-60">{isSaving ? km.actions.saving : km.admin.saveSettings}</button>
          </div>
        </div>
      </section>

      {roles.includes('OWNER') && <section className="rounded-[30px] border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-black text-slate-900">{km.telegram.ownerPairingStart}</h2><p className="mt-1 text-sm text-slate-600">{km.telegram.ownerPairingHint}</p></div><button onClick={() => void createOwnerPairing()} disabled={isCreatingPairing} className="inline-flex items-center gap-2 rounded-xl bg-[var(--portal-primary)] px-5 py-3 text-sm font-black text-white disabled:opacity-60"><Link className="size-4"/>{isCreatingPairing ? km.actions.saving : km.telegram.ownerPairingStart}</button></div>
        {pairingUrl && <a href={pairingUrl} target="_blank" rel="noreferrer" className="mt-4 block break-all rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-[var(--portal-primary)] underline">{pairingUrl}</a>}
      </section>}

      {canManageScopes && <section className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-1 text-emerald-800"/><div><h2 className="text-xl font-black">{km.admin.accessScopesTitle}</h2><p className="text-sm text-slate-600">{km.admin.accessScopesSubtitle}</p></div></div>
        {scopeUsers.length === 0 && <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{km.admin.noAdminUsers}</p>}
        {scopeUsers.map((user) => {
          const unrestricted = user.roles.some((role) => role.code === 'OWNER' || role.code === 'HR');
          return <article key={user.id} className="rounded-2xl border border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-slate-900">{user.email}</h3><p className="text-xs text-slate-500">{user.roles.map((role) => role.name).join(' · ')}</p></div>{!unrestricted && <button disabled={savedScopeSignatures[user.id] === scopeSignature(user) || Boolean(savingScopeUserId)} onClick={() => setConfirmScopeUser(user)} className="rounded-xl bg-[var(--portal-primary)] px-4 py-2 text-sm font-bold text-white hover:brightness-90 disabled:cursor-not-allowed disabled:bg-slate-300">{savingScopeUserId === user.id ? km.actions.saving : km.admin.saveAccess}</button>}</div>
            {unrestricted ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{km.admin.unrestrictedAccess}</p> : <div className="mt-4 grid gap-5 lg:grid-cols-2"><ScopeList title={km.admin.projectAccess} items={projects} selected={user.projects.map((item) => item.id)} label={(item) => `${item.code} · ${item.name}`} onToggle={(item) => toggleScope(user.id, 'projects', item)}/><ScopeList title={km.admin.siteAccess} items={sites} selected={user.sites.map((item) => item.id)} label={(item) => `${item.projectName ?? ''} · ${item.name}`} onToggle={(item) => toggleScope(user.id, 'sites', item)}/></div>}
          </article>;
        })}
      </section>}
      <ConfirmActionDialog open={confirmSettings} title={km.actions.confirmSettingsTitle} description={km.actions.confirmSettingsDescription} confirmLabel={km.actions.confirmChanges} pending={isSaving} onCancel={() => setConfirmSettings(false)} onConfirm={() => void save()} />
      <ConfirmActionDialog open={Boolean(confirmScopeUser)} title={km.actions.confirmAccessTitle} description={km.actions.confirmAccessDescription} confirmLabel={km.admin.saveAccess} pending={Boolean(savingScopeUserId)} onCancel={() => setConfirmScopeUser(null)} onConfirm={() => confirmScopeUser && void saveScope(confirmScopeUser)} />
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactElement }) {
  return <label className="text-xs font-black text-slate-600">{label}<span className="mt-2 block [&>*]:h-12 [&>*]:w-full [&>*]:rounded-xl [&>*]:border [&>*]:border-slate-200 [&>*]:bg-slate-50 [&>*]:px-3">{children}</span></label>;
}

function ScopeList<T extends { id: string }>({ title, items, selected, label, onToggle }: { title: string; items: T[]; selected: string[]; label: (item: T) => string; onToggle: (item: T) => void }) {
  return <fieldset><legend className="mb-2 text-xs font-black text-slate-600">{title}</legend><div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{items.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item)}/><span>{label(item)}</span></label>)}</div></fieldset>;
}
