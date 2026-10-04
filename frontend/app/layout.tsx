import './globals.css';
import AppShell from '../components/AppShell';

export const metadata = {
  title: 'Motion — Social momentum, on autopilot',
  description: 'A calm command center for publishing and engaging across social.',
};

const themeInit = `(function(){try{var t=localStorage.getItem('motion-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0e1526" />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
