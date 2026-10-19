import type { Metadata } from 'next';
import './globals.css';
import './auth-extras.css';
import AppExperience from '@/components/app-experience';
import AppNavigationShell from '@/components/app-navigation-shell';

export const metadata: Metadata = {
  title: 'VAI Project Manager',
  description: 'Plan, monitor and manage every project with VAI Project Manager.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppNavigationShell>{children}</AppNavigationShell><AppExperience /></body></html>;
}
