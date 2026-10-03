import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Workforce Attendance',
  description: 'Site Attendance & Verification Mini App',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script async src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="mini-stage min-h-screen bg-zinc-100 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <div className="mini-stage__signal" aria-hidden="true" />
        <main className="relative mx-auto max-w-md min-h-screen flex flex-col">{children}</main>
      </body>
    </html>
  );
}
