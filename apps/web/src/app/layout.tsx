import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Book Splicer | Make room for the good parts',
  description: 'Select, reorder, and export PDF pages, EPUB chapters, and comic pages. Privately, right in your browser.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<Toaster richColors closeButton position="bottom-right" /></body></html>;
}
