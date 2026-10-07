import './globals.css';
import { Montserrat, JetBrains_Mono } from 'next/font/google';
import AppShell from '../components/AppShell';
import { SessionProvider } from '../lib/session';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

// Self-hosted by next/font: no render-blocking request to Google Fonts and no layout shift on load.
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat', display: 'swap' }); // variable font, so the in-between weights (425/525/625/725) render as designed

const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' }); // code blocks (Cailyx uses Geist Mono; Next 14 has no Geist, so JetBrains Mono stands in)

export const metadata = {
  title: 'Motion',
  description: 'A calm command center for publishing and engaging across social.',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9f9f9' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1b1e' },
  ],
};

const themeInit = `(function(){try{var t=localStorage.getItem('motion-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${montserrat.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <SessionProvider>
          <TooltipProvider delayDuration={300}>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
        </SessionProvider>
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
