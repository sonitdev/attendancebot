export interface PortalBranding {
  id?: string;
  name?: string | null;
  logoUrl?: string | null;
  brandPrimaryColor?: string | null;
  brandAccentColor?: string | null;
  defaultLocale?: string | null;
}

export const PORTAL_BRANDING_UPDATED = 'workforce:portal-branding-updated';
const PORTAL_BRANDING_CACHE_PREFIX = 'workforce_portal_branding';

function cacheKey(organizationId: string) {
  return `${PORTAL_BRANDING_CACHE_PREFIX}:${organizationId}`;
}

export function readPortalBranding(organizationId: string): PortalBranding | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(cacheKey(organizationId));
  if (!raw) return null;
  try {
    const branding = JSON.parse(raw) as PortalBranding;
    return branding.id === organizationId ? branding : null;
  } catch {
    localStorage.removeItem(cacheKey(organizationId));
    return null;
  }
}

export function publishPortalBranding(branding: PortalBranding) {
  if (typeof window === 'undefined') return;
  if (branding.id) {
    localStorage.setItem(cacheKey(branding.id), JSON.stringify(branding));
  }
  window.dispatchEvent(new CustomEvent<PortalBranding>(PORTAL_BRANDING_UPDATED, { detail: branding }));
}
