#!/usr/bin/env node
/*
  Real delivery test for the listing enquiry email route.

    npm run listings:test-delivery                 dry run: shows exactly what would be sent, sends nothing
    npm run listings:test-delivery -- --send       sends ONE clearly labelled test email through Resend

  It uses the same sink, the same Resend sender and the same recipient as /api/listing-enquiry/, so a
  successful run proves the real delivery path: the API key, the verified sending domain and the inbox. It
  contains no personal data and no listing. The recipient must be an @sdahomechoices.com.au address (default:
  the address the endpoint delivers to); anything else is refused.

  --send is deliberately a separate, explicit step: it sends a real email. Run it only when you intend to.
  Needs RESEND_API_KEY (from .env or .env.listings, both git-ignored). The key is never printed.

  Note: the endpoint itself only accepts an enquiry for a PUBLISHED listing, so with no listing live this
  cannot be exercised through the endpoint. Run this script now, then repeat the check through the endpoint
  on the first Vercel Preview that carries the proposed snapshot, with LISTINGS_ENQUIRY_MODE=email set for
  Preview, before anything is merged.
*/
import { loadTs } from './lib/bundle-ts.mjs';

const argv = process.argv.slice(2);
const send = argv.includes('--send');
const toIdx = argv.indexOf('--to');
const to = toIdx > -1 ? argv[toIdx + 1] : 'steve@sdahomechoices.com.au';
const FROM = 'SDA Home Choices <noreply@send.sdahomechoices.com.au>';

if (!/^[A-Za-z0-9._%+-]+@sdahomechoices\.com\.au$/i.test(to ?? '')) {
  console.error('Refused: the test email can only go to an @sdahomechoices.com.au address.');
  process.exit(2);
}

const key = process.env.RESEND_API_KEY;
const L = await loadTs();
const subject = 'New listing enquiry: DELIVERY TEST (not a real enquiry)';

console.log(`${send ? 'SEND' : 'DRY RUN'}: listing enquiry delivery check`);
console.log(`  from:     ${FROM}`);
console.log(`  to:       ${to}`);
console.log(`  subject:  ${subject}`);
console.log(`  api key:  ${key ? 'present (value not shown)' : 'MISSING'}`);
console.log(`  mode:     ${process.env.LISTINGS_ENQUIRY_MODE || '(not set; the endpoint answers 503 outside astro dev until it is "email")'}`);

if (!send) {
  console.log('\nNothing was sent. Re-run with --send to deliver this one test email.');
  process.exit(key ? 0 : 1);
}
if (!key) {
  console.error('\nRESEND_API_KEY is not set. Add it to .env or .env.listings and try again.');
  process.exit(1);
}

const { Resend } = await import('resend');
const resend = new Resend(key);
let failure = null;
const sink = L.createEmailSink(async (msg) => {
  const r = await resend.emails.send({ from: FROM, ...msg });
  if (r.error) failure = r.error;
  return r;
}, to);

const now = new Date();
const record = L.toRecord({ listingId: 'delivery-test', name: 'Delivery test', email: to, message: 'Automated delivery check for the listing enquiry route. This is not an enquiry and needs no reply.', consent: true, source: 'listing_page' }, now);
const out = await sink.deliver(record, { title: 'DELIVERY TEST (not a real enquiry)', id: 'delivery-test' });
if (out.ok) {
  console.log('\nAccepted by Resend. Now confirm the message arrived in the inbox (and not in spam).');
  process.exit(0);
}
console.error(`\nDelivery failed${failure ? `: ${failure.name ?? 'error'}: ${failure.message ?? ''}` : ''}`);
console.error('Common causes: the key is wrong, or the sending domain send.sdahomechoices.com.au is not verified in Resend.');
process.exit(1);
