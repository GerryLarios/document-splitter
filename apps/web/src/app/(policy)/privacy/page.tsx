import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy policy | Book Splicer' };

export default function PrivacyPage() {
  return <article>
    <h1>Privacy policy</h1>
    <h2>Who operates this service</h2>
    <p>Book Splicer is operated by Gerardo Manuel Chavez Larios in Mexico. For privacy questions or requests, email <a href="mailto:gerardo.larios69@gmail.com">gerardo.larios69@gmail.com</a>.</p>
    <h2>Your documents</h2>
    <p>Book Splicer processes documents in your browser. The app does not upload documents for processing or save them as projects on a server or in browser storage. Document data is held in browser memory while you work. Exports are saved to your device through your browser; you control those downloaded files.</p>
    <h2>Website requests and hosting</h2>
    <p>Your browser requests the app and its assets over the network. Netlify hosts the site and may receive information such as your IP address, request URL, browser information, and timestamps to deliver, secure, and monitor it. Netlify’s Observability service provides request-level information, such as request paths, status codes, regions, and response times; on the Free plan its dashboard can show the past 24 hours. This dashboard window does not establish how long Netlify retains underlying data. The storage locations, recipients, and retention periods for that data have not yet been confirmed. See <a href="https://www.netlify.com/privacy/">Netlify’s privacy notice</a> for information about its practices.</p>
    <h2>Cookies and analytics</h2>
    <p>The app itself does not include client-side analytics or set tracking cookies. If enabled, Netlify Web Analytics uses server-side request data to show statistics such as pageviews, visitor counts, and country-level locations; its dashboard can show the past 30 days. Netlify says the service does not use cookies and counts unique visitors using IP addresses. Whether Web Analytics is enabled and whether hosting or other services use cookies or similar technologies has not yet been confirmed.</p>
    <h2>Contact and your rights</h2>
    <p>If you contact us, we will receive the information you choose to provide, including your email address and message. Depending on applicable law, you may have rights concerning your personal information, including rights of access, correction, deletion or objection. In Mexico these include applicable ARCO rights. To make a request, email the address above. You may also have the right to complain to a relevant data protection authority.</p>
  </article>;
}
