import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from '@/components/providers';

export const metadata: Metadata = {
  title: 'SM Clock — Plataforma SaaS de Control de Asistencia',
  description:
    'Sincronización de asistencia en tiempo real para relojes ZKTeco, Hikvision y TA.Cloud hacia CONTPAQi Nóminas, TRESS y RH4000.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SM Clock',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

const FOUC_COLOR_SCHEME_SCRIPT = `
try {
  var s = localStorage.getItem("color-scheme");
  var m = document.querySelector('meta[name="color-scheme"]');
  if (m) m.content = (s === "light" || s === "dark") ? s : "light dark";
  var isDark = s === "dark" || (!s && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", !isDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
} catch (_) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-MX" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{ __html: FOUC_COLOR_SCHEME_SCRIPT }}
        />
      </head>
      <body suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
