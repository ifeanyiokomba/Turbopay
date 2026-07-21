import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TurboPay Admin Dashboard',
  description: 'Payment orchestration admin panel',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
