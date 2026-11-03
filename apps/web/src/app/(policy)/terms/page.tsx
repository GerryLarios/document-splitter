import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of service | Book Splicer' };

export default function TermsPage() {
  return <article>
    <h1>Terms of service</h1>
    <p>Book Splicer is operated by Gerardo Manuel Chavez Larios in Mexico. Questions about the service can be sent to <a href="mailto:gerardo.larios69@gmail.com">gerardo.larios69@gmail.com</a>.</p>
    <h2>Using Book Splicer</h2>
    <p>Book Splicer lets you select, rearrange, and export parts of supported documents in your browser. You are responsible for using the service lawfully and for having any rights or permissions needed to process, share, or distribute your documents. Do not use the service to interfere with its operation or harm others.</p>
    <h2>Your documents and exports</h2>
    <p>You retain your rights in your documents. Keep your original files and check exports before relying on or sharing them. Exports may not preserve every feature, signature, annotation, or other information. Book Splicer is not a secure redaction tool; removed material or metadata may still be present in an export.</p>
    <h2>Availability and limitations</h2>
    <p>The service may change, be unavailable, or fail to process particular files. To the extent permitted by applicable law, it is provided as is, without warranties, and the operator is not liable for losses arising from its use. Nothing in these terms limits rights or liability that cannot legally be limited.</p>
    <h2>Privacy</h2>
    <p>See the <a href="/privacy">privacy policy</a> for information about documents and website requests.</p>
  </article>;
}
