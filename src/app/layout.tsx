import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Яндекс.Музыка → Spotify',
  description: 'Перенос лайков, плейлистов и «Моей волны» из Яндекс.Музыки в Spotify',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
