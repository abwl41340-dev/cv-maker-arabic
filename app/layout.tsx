import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'صيغة | محوّل الملفات الذكي',
  description: 'أداة تحويل الملفات والوثائق والصور بشكل احترافي وسريع.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
