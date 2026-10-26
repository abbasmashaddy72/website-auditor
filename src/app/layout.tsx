import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Website Auditor | Universal Diagnostics',
  description: 'Independent local and public website diagnostics dashboard',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
