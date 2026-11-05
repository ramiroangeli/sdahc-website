export const prerender = false;
import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { getPublicListings } from '../../data/listings';
import { createEmailSink, dryRunSink, hashKey, parseEnquiry, RateLimiter, toRecord } from '../../lib/enquiries';
import { isAllowedOrigin, json } from '../../lib/enquiry-http';

/*
  Enquiry about one specific published listing. See src/lib/enquiries.ts for the full flow.

  Delivery modes (LISTINGS_ENQUIRY_MODE):
    email    send through Resend. The only mode that reports success on a real deployment.
    dry-run  validate and report success with NO delivery. Allowed in `astro dev` only.
    unset    503 everywhere except `astro dev`, so a deployment can never silently swallow an enquiry.
  The Notion CRM step is not wired yet; see docs/opportunities-listings-v2.md.
*/

// per instance; the Vercel Firewall rate-limit rule on this path is the real control
const perIp = new RateLimiter(5, 10 * 60 * 1000);
const perEmail = new RateLimiter(3, 60 * 60 * 1000);

const mode = () => (import.meta.env.DEV && process.env.LISTINGS_LOCAL_PREVIEW === '1' ? 'dry-run' : import.meta.env.LISTINGS_ENQUIRY_MODE) || (import.meta.env.DEV ? 'dry-run' : '');

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const devHosts = import.meta.env.DEV ? ['localhost:4321', '127.0.0.1:4321'] : [];
  if (!isAllowedOrigin(request, devHosts)) return json({ ok: false, error: 'Request not allowed.' }, 403);

  const m = mode();
  if (m !== 'email' && m !== 'dry-run') return json({ ok: false, error: 'Enquiries are not enabled yet.' }, 503);
  if (m === 'dry-run' && !import.meta.env.DEV) return json({ ok: false, error: 'Enquiries are not enabled yet.' }, 503);

  const now = new Date();
  if (!perIp.allow(hashKey(clientAddress ?? 'unknown'), now.getTime())) {
    return json({ ok: false, error: 'Too many enquiries from this connection. Please try again later.' }, 429);
  }

  const parsed = parseEnquiry(await request.formData(), now.getTime());
  if (!parsed.ok) return parsed.status === 204 ? json({ ok: true }) : json({ ok: false, error: parsed.error }, parsed.status);
  if (!perEmail.allow(hashKey(parsed.value.email), now.getTime())) {
    return json({ ok: false, error: 'We already have your recent enquiries. We will be in touch.' }, 429);
  }

  // server-side allowlist: only a currently published listing can receive an enquiry
  const listing = getPublicListings(now).find((l) => l.id === parsed.value.listingId);
  if (!listing) return json({ ok: false, error: 'This listing is no longer available.' }, 404);

  const record = toRecord(parsed.value, now);
  if (m === 'dry-run') {
    await dryRunSink.deliver(record, listing);
    return json({ ok: true, dryRun: true });
  }

  const key = import.meta.env.RESEND_API_KEY;
  if (!key) return json({ ok: false, error: 'Email is not configured.' }, 500);
  const resend = new Resend(key);
  const sink = createEmailSink(
    (msg) => resend.emails.send({ from: 'SDA Home Choices <noreply@send.sdahomechoices.com.au>', ...msg }),
    'steve@sdahomechoices.com.au',
  );
  const out = await sink.deliver(record, listing);
  return out.ok ? json({ ok: true }) : json({ ok: false, error: 'Could not send. Please try again.' }, 502);
};
