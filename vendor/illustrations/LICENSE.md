# vendor/illustrations — the CC0 review assets

These five SVG files are here for ONE reason: to render the empty-state review
board (`preview/empty.html`) so the illustration question can be answered by
looking rather than by argument. They are **not part of the app**, they are not
served (nothing under `vendor/illustrations/` appears in
`tools/deploy-ghpages.mjs`'s `SERVED` list), and if none of the sets fits, they
and this file are deleted.

They are inlined into that one page at build time by
`tools/build-ui-options.mjs`, so the review costs one request and no third-party
fetch.

## The licence, and why it is the only kind that could come here

All three sets are **CC0 1.0 Universal** (Public Domain Dedication) by **Pablo
Stanley**. CC0 is the one licence with no conditions at all — not even
attribution — so committing the files into a public repository is not a
permission that has to be asked for or granted. That is the whole reason the
shortlist is these three and not the more popular sets: **the question that
matters is not "is it free" but "may the SVG be redistributed in this repo"**,
and most of the illustration world answers no to the second.

| Set | Licence | Source of the copies here |
|---|---|---|
| Open Doodles | CC0 1.0 | <https://www.opendoodles.com/> — assets served from `opendoodles.s3-us-west-1.amazonaws.com` |
| Open Peeps | CC0 1.0 | <https://www.openpeeps.com/> |
| Humaaans | CC0 1.0 | <https://www.humaaans.com/> |

Each site states it in its own words, and that statement — not this file — is
the licence:

- Open Doodles: *"Free for Commercial and Personal Use. No need to credit,
  license, or anything."*
- Open Peeps: *"The library is in the public domain under the CC0 License."*
- Humaaans: *"CC0 Public Domain License."*

The full text of CC0 1.0 is at
<https://creativecommons.org/publicdomain/zero/1.0/legalcode>.

## Attribution, given anyway

CC0 asks for nothing. The credit goes in anyway, because a public repository
that carries other people's artwork ought to say whose it is, and because the
"no attribution required" line is exactly what tempts a project to stop
noticing where its files came from.

Illustrations © Pablo Stanley, released under CC0 1.0.

## What is NOT here

- **Tabler's illustrations.** A paid product from codecalm.net whose licence
  forbids use in open-source or freely-available products, which this public
  repository is. Tabler's *CSS and icons* are MIT and were read for their
  measured geometry — that is all.
- **unDraw.** The most-recommended "free" set on the web, and a trap: its terms
  forbid distributing the assets in packs, which is precisely what vendoring
  them here would be.
- Storyset, Blush, DrawKit, ManyPixels and absurd.design — bespoke licences,
  variously restrictive, none of them committable.
