# SDA Home Choices website (Astro)

Rules for every change in this repo.

## Hard rules
- NEVER use the em-dash "—" anywhere: not in page copy, headings, comments, alt text, or commit messages. Use commas, colons, parentheses, or rewrite the sentence. The en-dash "–" is allowed only inside numeric ranges (e.g. 2019–26).
- Design tokens in `src/styles/tokens.css` are the single source of truth. Never hardcode colours or font names in components; always use `var(--navy)`, `var(--blue)`, `var(--serif)`, etc. If a new token is genuinely needed, add it to `tokens.css`.
- Preserve URLs exactly. Each existing site URL maps to one file under `src/pages` with the identical path and a trailing slash. Do not rename or invent routes.
- All site content is in English (Australian English spelling: organise, colour, specialise).
- Accessibility: semantic HTML; every image needs alt text; never set `maximum-scale` or `user-scalable=0` on the viewport; aim for WCAG AA contrast.
- No secrets in code. API keys go in Vercel environment variables, never committed.

## Confirmed facts (use these exact figures in copy)
- $1B+ transacted and advised across the sector.
- 25+ years of specialist commercial experience.
- SDA Market Report 2026: 76 pages, free.

## Conventions
- Reuse components in `src/components` before creating new ones.
- Component styles use Astro scoped `<style>`; shared base styles live in `src/styles/global.css`.
- Verify every visual change against the rendered site (`npm run dev`, or `npm run build && npm run preview`), not just the source.
- If a result is unexpected or a decision is ambiguous, STOP and report back. Do not make autonomous compensating changes (spacing, colours, layout).
- Commit after each self-contained block of work with a clear, descriptive message.

## Stack
- Astro, static output, deployed on Vercel via git push. No database. The only server-side pieces (added in a later step) are serverless handlers for the contact form and the report gate.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
