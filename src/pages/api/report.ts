export const prerender = false;
import type { APIRoute } from 'astro';
import { Resend } from 'resend';

function normalizeAuPhone(raw: string) {
  let n = raw.replace(/[\s\-()]/g, '');
  if (n.startsWith('0')) n = n.slice(1);
  return n;
}

const REPORT_NAMES: Record<string, string> = {
  sda2026: 'SDA Market Report 2026',
  special: 'SDA Administration & Special Situations Report',
};

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedOrigin(request)) return json({ ok: false, error: 'Request not allowed.' }, 403);

  const data = await request.formData();
  // honeypot: real users never fill this hidden field
  if ((data.get('company') as string)?.trim()) return json({ ok: true });

  const firstName = (data.get('first_name') as string || '').trim();
  const lastName = (data.get('last_name') as string || '').trim();
  const email = (data.get('email') as string || '').trim();
  const phone = (data.get('phone') as string || '').trim();
  const role = (data.get('role') as string || '').trim();
  const state = (data.get('state') as string || '').trim();
  const comments = (data.get('comments') as string || '').trim();
  const reportKey = (data.get('report') as string || 'sda2026').trim();
  const reportName = REPORT_NAMES[reportKey] || REPORT_NAMES.sda2026;
  const normalizedPhone = normalizeAuPhone(phone);

  if (!firstName || !lastName || !/.+@.+\..+/.test(email)) {
    return json({ ok: false, error: 'Please complete all fields.' }, 400);
  }
  if (!/^[23478]\d{8}$/.test(normalizedPhone)) {
    return json({ ok: false, error: 'Please enter a valid Australian phone number.' }, 400);
  }
  if (
    firstName.length > 100 || lastName.length > 100 || email.length > 200 ||
    phone.length > 40 || role.length > 200 || state.length > 200 || comments.length > 2000
  ) {
    return json({ ok: false, error: 'One or more fields is too long.' }, 400);
  }
  const key = import.meta.env.RESEND_API_KEY;
  if (!key) return json({ ok: false, error: 'Email is not configured.' }, 500);

  const resend = new Resend(key);
  const formattedPhone = `+61 ${normalizedPhone}`;
  const rows = [...data.entries()]
    .filter(([k]) => k !== 'company' && k !== 'phone' && k !== 'phone_country' && k !== 'report')
    .map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</p>`)
    .join('') + `<p><strong>phone:</strong> ${escapeHtml(formattedPhone)}</p>`;
  const { error } = await resend.emails.send({
    from: 'SDA Home Choices <noreply@send.sdahomechoices.com.au>',
    to: 'research@sdahomechoices.com.au',
    replyTo: email,
    subject: `New ${reportName} download from ${firstName}`,
    html: `<h2>New ${reportName} download</h2>${rows}`,
  });
  if (error) return json({ ok: false, error: 'Could not send. Please try again.' }, 502);
  return json({ ok: true });
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// accepts our own production domain and Vercel preview deployments; rejects everything else,
// including requests with no Origin/Referer at all (a genuine same-origin fetch always sends one)
const isAllowedOrigin = (request: Request) => {
  const raw = request.headers.get('origin') || request.headers.get('referer');
  if (!raw) return false;
  try {
    const host = new URL(raw).host;
    return host === 'sdahomechoices.com.au' || host.endsWith('.sdahomechoices.com.au') || host.endsWith('.vercel.app');
  } catch {
    return false;
  }
};
