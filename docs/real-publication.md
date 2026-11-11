# Real publication from the Listings Manager

How a listing goes live, and what protects the live site. English on purpose: it is read by whoever administers the repository.

## Flow (workflow `publish-listing.yml`, mode `publish` or `update`)
1. The app freezes the approved public content and copies the approved WebP images to the public media store (`<LISTINGS_MEDIA_BASE_URL>/<public id>/`), then starts the workflow.
2. The job re-runs the existing engine, the listings tests, a production build and the privacy scan, exactly as in a dry run.
3. It checks the images and `manifest.json` are on the public media origin, in the approved order.
4. It opens ONE pull request on a branch `publish/<public id>-v<version>-<hash>` that changes ONLY `src/data/listings/approved/<slug>.json`. Any other changed file stops the run before the pull request exists.
5. The pull request is opened with the token of the GitHub App "SDAHC Listings Publisher", so GitHub starts the normal `pull_request` run of `ci.yml` by itself. The job waits for that run's check `site-checks` on the exact commit (it never starts CI by hand: a manual run would not satisfy the rules). If the check has not appeared after 3 minutes the job stops and the pull request is closed.
6. It squash-merges that exact commit with the same App token. The rules on `main` decide whether the merge is allowed (the App is not a bypass actor); a refusal is reported, never worked around. A refused merge is tried again at most 3 more times, 5 seconds apart, only to cover GitHub registering a check that has just finished.
7. It waits for the Vercel Production deployment of the merge commit, then fetches the live listing page, every image and the catalogue.
8. Only then does it report `finished: succeeded`, which is the single signal the app turns into **Live**.

## Failure and retries
- A failure BEFORE the merge closes the pull request and deletes the branch: `main`, and so the live site, is untouched.
- A failure AFTER the merge (deployment or live check) cannot undo the merge: the change is on `main`. The job reports `merged: true` and the merge commit, the app shows "merged, not yet confirmed live" (never Live), and publishing again resumes from the merge and only re-checks the deployment and the live site. Vercel keeps serving the previous production deployment until a new one succeeds.
- Rerunning is safe: an existing branch and pull request are reused; if the file is already on `main` the job goes straight to deployment and live checks.
- Logs of this public repository carry step names only: never listing text, prices or internal values.

## The GitHub App
- Name "SDAHC Listings Publisher", installed ONLY on this repository, not a bypass actor on the `main` ruleset, webhooks off.
- Repository permissions: Contents RW, Pull requests RW, Actions RW (the Listings Manager starts the workflow with it), Checks R, Deployments R, Metadata R. Nothing else (no Workflows, Administration, Statuses, Secrets or Environments).
- In this repository: Actions secrets `LISTINGS_APP_ID` and `LISTINGS_APP_PRIVATE_KEY`. In the Listings Manager (Vercel, Production, Sensitive): `LISTINGS_GITHUB_APP_ID`, `LISTINGS_GITHUB_APP_INSTALLATION_ID`, `LISTINGS_GITHUB_APP_PRIVATE_KEY`, and `LISTINGS_GITHUB_AUTH=app` once proven.
- The workflow's own token is read-only. The job gets a token created for the real modes only (`actions/create-github-app-token`, pinned by commit), limited to this repository and to contents write, pull requests write, checks read, deployments read; it expires within the hour and is revoked when the job ends. A dry run creates none.
- Rotating the key: generate a new private key in the App settings, replace the two secrets (Actions and Vercel), redeploy the Listings Manager, delete the old key. No code change.

## Settings the workflow needs (Settings > Actions > General)
- Workflow permissions: Read and write permissions is NOT needed (the workflow declares its own). **Allow GitHub Actions to create and approve pull requests** is no longer needed for publication (the App opens the pull request); leave it as it is.
- Variable `LISTINGS_SITE_URL` (optional, default `https://sdahomechoices.com.au`).
- Apply `docs/github-ruleset-main.json` (Settings > Rules > Rulesets > Import) only after `ci.yml` is on `main`.

## Commercial status (Available, Under offer, Sold)

- The status is chosen in the Listings Manager by a Publisher and travels in the signed payload (`content.commercialStatus`) only when it changes. Notion's Web Listing Status is **not** consulted: the job overlays the property with the approved content and takes the status from the payload, else from the snapshot already on `main`, else Available for a first publication. A content update therefore never resets Under offer or Sold.
- A status-only change keeps the snapshot's version and content hash and moves only `commercialStatus` (the engine's `status` kind, now accepted for `update`). It has its own branch name, a pull request titled "Update <slug> (status: sold)" and no person's name anywhere.
- The Listing End Date is read from the existing snapshot only; a Notion value cannot enter a snapshot through the portal. No scheduler exists: a snapshot's end date takes effect only at the next build.
- The live check also confirms the status badge, and for Sold that the page carries no enquiry form and no "Enquire about this property".
- A Sold listing stays public and in the catalogue (badge Sold, no price), its page says it has been sold and offers a general enquiry route, structured data carries no offer, and the enquiry endpoint answers 409.

## Withdrawal (remove a listing from public marketing)

- **Mode `withdraw`** of the same workflow and GitHub App path. The job needs no Notion and no content: its payload is only the listing id, the action and a timestamp. It builds the site **without** the listing in the runner's workspace and requires `check:withdrawal` (against the public output, `.vercel/output/static`) and the privacy scan to pass **before** any pull request exists. Then one pull request adds `src/data/listings/withdrawn/<id>.json`, the required check runs, it merges, Vercel deploys, and the job proves the page answers 404 and the catalogue and sitemap no longer list it. Only then does it report `withdrawn`.
- **Public means constant words.** The tombstone is `{ listingId, withdrawnAt, withdrawnBy: "SDA Home Choices", reason: "withdrawn" }`. The reason and the person who asked live only in the Listings Manager's private audit trail (`listings.audit_log`) and never reach this repository, its pull requests, commit messages, Actions logs, workflow inputs or callbacks. The emergency command-line withdrawal writes the same constant file and does not store a `--reason` or `--by`.
- **What stays.** The approved snapshot (needed to reinstate) and the public photographs. The page URL answers 404. The server function bundle still contains the listing data (it was public in this repository already), so `check:withdrawal` is run against the public output only.
- A rerun after the merge only verifies. Reinstating is a separate release; until then the emergency command `--reinstate` through a reviewed pull request is the only way back.
