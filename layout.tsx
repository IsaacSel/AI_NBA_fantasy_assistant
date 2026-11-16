import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import { AppDataProvider } from '@/components/AppDataProvider';
import { AppShellLayout } from '@/components/AppShellLayout';
import './globals.css';
export const metadata: Metadata = {
  title: 'Fantasy Hoops Lab — 2025–26 Player Averages',
  description: 'Fantasy basketball rankings, comparisons, manual draft tracking and simulated snake drafts using the supplied 2025–26 NBA player averages CSV.',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" {...mantineHtmlProps}><head><ColorSchemeScript defaultColorScheme="auto" /></head>
    <body><MantineProvider defaultColorScheme="auto" theme={{ primaryColor: 'orange', defaultRadius: 'md' }}>
      <AppDataProvider><AppShellLayout>{children}</AppShellLayout></AppDataProvider>
    </MantineProvider></body></html>;
}
