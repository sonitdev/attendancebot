import type { Metadata, Viewport } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import { AuthProvider } from '@/lib/auth-context';
import { LocaleProvider } from '@/lib/locale-context';
import { AdminShell } from '@/components/layout/admin-shell';
import { km } from '@workforce/contracts';

export const metadata: Metadata = {
  title: km.app.title,
  description: km.app.description,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="km">
      <body className="font-sans antialiased text-slate-900 bg-[#f2f6f4]">
        <AuthProvider>
          <LocaleProvider>
            <AdminShell>{children}</AdminShell>
          </LocaleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
