import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Khmer } from 'next/font/google';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import { AuthProvider } from '@/lib/auth-context';
import { AdminShell } from '@/components/layout/admin-shell';

const notoSans = Noto_Sans_Khmer({
  subsets: ['khmer'],
  variable: '--font-noto-sans',
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'ប្រព័ន្ធវត្តមានការដ្ឋាន',
  description: 'ប្រព័ន្ធគ្រប់គ្រងបុគ្គលិក និងវត្តមានការដ្ឋាន',
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
    <html lang="km" className={`${notoSans.variable}`}>
      <body className="font-sans antialiased text-slate-900 bg-[#f2f6f4]">
        <AuthProvider>
          <AdminShell>{children}</AdminShell>
        </AuthProvider>
      </body>
    </html>
  );
}
