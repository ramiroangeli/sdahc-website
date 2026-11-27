# Font licences

Every family below is licensed under the SIL Open Font License 1.1 (OFL). The original licence text sits next to the files, in `public/fonts/<family>/OFL.txt`.
The files are woff2 subsets of the official TTFs, each split into `-latin` (Basic Latin, typographic punctuation, arrows, common symbols) and `-latin1` (accented letters and the rest of Latin-1 Supplement), chosen by `unicode-range`. Only the weights the site uses are shipped: Playfair Display (600, 700, italic 400, 500, 600), Barlow Condensed (600, 700) and the /research/ families are static instances cut from the official variable files (fonttools instancer); Source Sans 3 and Space Grotesk stay variable (smaller than their static weights put together).
Source: the official Google Fonts repository, https://github.com/google/fonts (path `ofl/<family>`), downloaded 2026-11-27.

| Family | Author | Origin | Version | Licence | Downloaded | Used for |
|---|---|---|---|---|---|---|
| Playfair Display (static 600, 700, italic 400, 500, 600) | Claus Eggers Sørensen | https://github.com/google/fonts/tree/main/ofl/playfairdisplay | 1.203 | OFL 1.1 | 2026-11-27 | `--serif`: headings, quotes |
| Source Sans 3 (variable wght) | Paul D. Hunt (Adobe) | https://github.com/google/fonts/tree/main/ofl/sourcesans3 | 3.052 | OFL 1.1 | 2026-11-27 | `--sans`: body text |
| Barlow Condensed (SemiBold 600, Bold 700) | Jeremy Tribby | https://github.com/google/fonts/tree/main/ofl/barlowcondensed | 1.408 | OFL 1.1 | 2026-11-27 | `--cond`: condensed display text |
| Space Grotesk (variable wght) | Florian Karsten | https://github.com/google/fonts/tree/main/ofl/spacegrotesk | 2.000 | OFL 1.1 | 2026-11-27 | `--geo`: labels, buttons, eyebrows |
| Climate Crisis (1979 style) | Eino Korkala, Daniel Coull | https://github.com/dancoull/ClimateCrisis | as shipped with the site | OFL 1.1 | 2026-11-26 | display titles (GradientDisplay) |
| Bricolage Grotesque (wght pinned at 700, variable opsz and wdth) | Mathieu Triay | https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque | 1.001 | OFL 1.1 | 2026-11-27 | /research/ only |
| Source Serif 4 (italic, wght pinned at 400, variable opsz) | Frank Grießhammer (Adobe) | https://github.com/google/fonts/tree/main/ofl/sourceserif4 | 4.004 | OFL 1.1 | 2026-11-27 | /research/ only |
| Plus Jakarta Sans (static 800) | Tokotype | https://github.com/google/fonts/tree/main/ofl/plusjakartasans | 2.071 | OFL 1.1 | 2026-11-27 | /research/ only |
| IBM Plex Mono (Regular 400, Medium 500) | Mike Abbink, Bold Monday (IBM) | https://github.com/google/fonts/tree/main/ofl/ibmplexmono | 2.3 | OFL 1.1 | 2026-11-27 | /research/ only |

Not used and not shipped: Frick and any other family. Source Sans 3 italic is not shipped (the site never loaded it, so italic body text is the browser's slanted roman, as before).
