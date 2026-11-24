import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Providers } from '@/components/providers';
import 'flag-icons/css/flag-icons.min.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MADP', template: '%s · MADP' },
  description: 'Master Audience Data Platform — Frequent Research Fieldwork Solutions',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so each gets the nonce of its own CSP (src/proxy.ts).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
