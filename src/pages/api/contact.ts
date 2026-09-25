export const prerender = false;
import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const POST: APIRoute = async ({ request }) => {
  const data = await request.formData();
  // honeypot: real users never fill this hidden field
  if ((data.get('company') as string)?.trim()) return json({ ok: true });

  const name = (data.get('name') as string || '').trim();
  const email = (data.get('email') as string || '').trim();
  const message = (data.get('message') as string || '').trim();
  if (!name || !/.+@.+\..+/.test(email) || !message) {
    return json({ ok: false, error: 'Please complete all fields.' }, 400);
  }
  const key = import.meta.env.RESEND_API_KEY;
  if (!key) return json({ ok: false, error: 'Email is not configured.' }, 500);

  const resend = new Resend(key);
  const rows = [...data.entries()]
    .filter(([k]) => k !== 'company')
    .map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</p>`)
    .join('');
  const { error } = await resend.emails.send({
    from: 'SDA Home Choices <noreply@send.sdahomechoices.com.au>',
    to: 'research@sdahomechoices.com.au',
    replyTo: email,
    subject: `New website enquiry from ${name}`,
    html: `<h2>New contact enquiry</h2>${rows}`,
  });
  if (error) return json({ ok: false, error: 'Could not send. Please try again.' }, 502);
  return json({ ok: true });
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
