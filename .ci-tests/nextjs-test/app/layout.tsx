import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nexus SDK Test',
  description: 'Testing Nexus SDK bundle compatibility',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
