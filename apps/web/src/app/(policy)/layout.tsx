import Link from 'next/link';

export default function PolicyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>
    <header className="site-header"><Link className="brand" href="/">book<span className="brand-light">splicer</span><span className="brand-dot">.</span></Link></header>
    <main className="policy-page">{children}</main>
    <footer className="site-footer"><Link href="/">Back to Book Splicer</Link><nav aria-label="Legal"><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of service</Link></nav></footer>
  </>;
}
