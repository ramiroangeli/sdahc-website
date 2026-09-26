export const prerender = false;
import type { APIRoute } from 'astro';
import { Resend } from 'resend';

function normalizeAuPhone(raw: string) {
  let n = raw.replace(/[\s\-()]/g, '');
  if (n.startsWith('0')) n = n.slice(1);
  return n;
}

export const POST: APIRoute = async ({ request }) => {
  const data = await request.formData();
  // honeypot: real users never fill this hidden field
  if ((data.get('company') as string)?.trim()) return json({ ok: true });

  const firstName = (data.get('first_name') as string || '').trim();
  const lastName = (data.get('last_name') as string || '').trim();
  const email = (data.get('email') as string || '').trim();
  const phone = (data.get('phone') as string || '').trim();
  const normalizedPhone = normalizeAuPhone(phone);

  if (!firstName || !lastName || !/.+@.+\..+/.test(email)) {
    return json({ ok: false, error: 'Please complete all fields.' }, 400);
  }
  if (!/^[23478]\d{8}$/.test(normalizedPhone)) {
    return json({ ok: false, error: 'Please enter a valid Australian phone number.' }, 400);
  }
  const key = import.meta.env.RESEND_API_KEY;
  if (!key) return json({ ok: false, error: 'Email is not configured.' }, 500);

  const resend = new Resend(key);
  const formattedPhone = `+61 ${normalizedPhone}`;
  const rows = [...data.entries()]
    .filter(([k]) => k !== 'company' && k !== 'phone' && k !== 'phone_country')
    .map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</p>`)
    .join('') + `<p><strong>phone:</strong> ${escapeHtml(formattedPhone)}</p>`;
  const { error } = await resend.emails.send({
    from: 'SDA Home Choices <noreply@send.sdahomechoices.com.au>',
    to: 'research@sdahomechoices.com.au',
    replyTo: email,
    subject: `New SDA Market Report download from ${firstName}`,
    html: `<h2>New SDA Market Report 2026 download</h2>${rows}`,
  });
  if (error) return json({ ok: false, error: 'Could not send. Please try again.' }, 502);
  return json({ ok: true });
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
