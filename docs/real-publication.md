# Real publication from the Listings Manager

How a listing goes live, and what protects the live site. English on purpose: it is read by whoever administers the repository.

## Flow (workflow `publish-listing.yml`, mode `publish` or `update`)
1. The app freezes the approved public content and copies the approved WebP images to the public media store (`<LISTINGS_MEDIA_BASE_URL>/<public id>/`), then starts the workflow.
2. The job re-runs the existing engine, the listings tests, a production build and the privacy scan, exactly as in a dry run.
3. It checks the images and `manifest.json` are on the public media origin, in the approved order.
4. It opens ONE pull request on a branch `publish/<public id>-v<version>-<hash>` that changes ONLY `src/data/listings/approved/<slug>.json`. Any other changed file stops the run before the pull request exists.
5. It starts `ci.yml` on that branch (pull requests made with the workflow token do not trigger `pull_request` workflows) and waits for the required check `site-checks` on that exact commit.
6. It squash-merges that exact commit. The rules on `main` decide whether the merge is allowed; a refusal is reported, never worked around.
7. It waits for the Vercel Production deployment of the merge commit, then fetches the live listing page, every image and the catalogue.
8. Only then does it report `finished: succeeded`, which is the single signal the app turns into **Live**.

## Failure and retries
- A failure BEFORE the merge closes the pull request and deletes the branch: `main`, and so the live site, is untouched.
- A failure AFTER the merge (deployment or live check) cannot undo the merge: the change is on `main`. The job reports `merged: true` and the merge commit, the app shows "merged, not yet confirmed live" (never Live), and publishing again resumes from the merge and only re-checks the deployment and the live site. Vercel keeps serving the previous production deployment until a new one succeeds.
- Rerunning is safe: an existing branch and pull request are reused; if the file is already on `main` the job goes straight to deployment and live checks.
- Logs of this public repository carry step names only: never listing text, prices or internal values.

## Settings the workflow needs (Settings > Actions > General)
- Workflow permissions: Read and write permissions is NOT needed (the workflow declares its own); **Allow GitHub Actions to create and approve pull requests** must be ON.
- Variable `LISTINGS_SITE_URL` (optional, default `https://sdahomechoices.com.au`).
- Apply `docs/github-ruleset-main.json` (Settings > Rules > Rulesets > Import) only after `ci.yml` is on `main`.
