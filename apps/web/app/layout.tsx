import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from '@/components/providers';

export const metadata: Metadata = {
  title: 'SM Clock — Plataforma SaaS de Control de Asistencia',
  description:
    'Sincronización de asistencia en tiempo real para relojes ZKTeco, Hikvision y TA.Cloud hacia CONTPAQi Nóminas, TRESS y RH4000.',
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
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
