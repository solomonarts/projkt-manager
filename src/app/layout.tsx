import type { Metadata } from 'next';
import './globals.css';
import './auth-extras.css';

export const metadata: Metadata = {
  title: 'Fieldnote — Project intelligence',
  description: 'Plan, monitor and learn from every project.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
