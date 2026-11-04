// Shared helpers for the listing enquiry endpoint. The three existing handlers (contact,
// opportunities, report) each carry their own copy of these; consolidating them is a separate
// clean-up and deliberately not done here, so those handlers stay untouched.

export const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// accepts our own production domain and Vercel preview deployments; rejects everything else,
// including requests with no Origin/Referer at all (a genuine same-origin fetch always sends one)
export const isAllowedOrigin = (request: Request, devHosts: string[] = []) => {
  const raw = request.headers.get('origin') || request.headers.get('referer');
  if (!raw) return false;
  try {
    const host = new URL(raw).host;
    return (
      host === 'sdahomechoices.com.au' ||
      host.endsWith('.sdahomechoices.com.au') ||
      host.endsWith('.vercel.app') ||
      devHosts.includes(host)
    );
  } catch {
    return false;
  }
};
