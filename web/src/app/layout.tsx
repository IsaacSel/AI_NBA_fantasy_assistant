import type { Metadata } from 'next';
import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps,
} from '@mantine/core';

import { AppDataProvider } from '@/components/AppDataProvider';
import { AppShellLayout } from '@/components/AppShellLayout';

import './globals.css';

export const metadata: Metadata = {
  title: 'Fantasy Hoops Lab',
  description: 'Player profiles, rankings, mock drafts, and streaming for our fantasy basketball league.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      {...mantineHtmlProps}
    >
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider
          defaultColorScheme="auto"
          theme={{
            primaryColor: 'orange',
            defaultRadius: 'md',
          }}
        >
          <AppDataProvider>
            <AppShellLayout>{children}</AppShellLayout>
          </AppDataProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
