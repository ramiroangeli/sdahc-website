# Writing a listing description

The description is one field. Write it as plain text; no HTML is needed or interpreted.

- A blank line starts a new block (a paragraph, a heading or a list).
- Lines starting with `- ` make a bullet list. A line ending in a colon directly above the list is its label, for example `Investment summary:`.
- A short line on its own (60 characters or fewer, no final punctuation) between other blocks is a heading. `## Heading` also makes one.
- Lines inside an ordinary block are joined with a space, so text pasted with hard line wraps reads as one paragraph.
- Markup such as `<b>` or `<script>` is shown as typed. It is never run.

On the listing page the first paragraph shows, and "Read full description" opens the rest (headings, lists and later paragraphs); "Show less" closes it. All of the text is in the page HTML for search engines. A one-paragraph description has no button.

Limits are technical only: up to 120 blocks, 6,000 characters in a block and 30,000 in total.

## What publication checks
Saving and previewing accept any text. Publication refuses text that contains a house or unit number, an email address, a phone number or a link to a private document system, and (unless approved, below) a dollar amount or income or yield wording.

### Approved commercial descriptions
SDAHC may publish commercial marketing it has already approved elsewhere (for example an existing public listing). A Publisher approves the exact description in the Listings Manager, with a private record of the source. The request then carries `descriptionApproval.textHash`, a hash of every block of the description and the structured commercial values. The engine recomputes it: any change to the text or those values voids the approval and the listing is refused until it is approved again. Only the financial wording scan is relaxed, only for the description. Addresses, emails, phones, private links and the CRM price are still refused. The title is never relaxed.

The approval holds only a hash. The approver, the source and the note stay private in the Listings Manager.

### Victorian listings
Income and yield (structured or in the description) are published only when the approval also carries the Victorian business authorisation (`victorian: true`, inside the hash). It records that SDAHC authorised the content (for example an existing public advertisement). It is not a legal classification and does not settle the Victorian advertising obligations. Without it the original restriction applies unchanged. Victorian pricing compliance is a separate check and is untouched.
