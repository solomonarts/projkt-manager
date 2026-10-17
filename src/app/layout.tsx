import type { Metadata } from 'next';
import './globals.css';
import './auth-extras.css';
import AppExperience from '@/components/app-experience';
import AppNavigationShell from '@/components/app-navigation-shell';

export const metadata: Metadata = {
  title: 'Fieldnote — Project intelligence',
  description: 'Plan, monitor and learn from every project.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppNavigationShell>{children}</AppNavigationShell><AppExperience /></body></html>;
}
