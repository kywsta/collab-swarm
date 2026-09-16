# Specification format

Start from the shared [specification template](../../workflow/templates/specification.md). Write it to `<plans>/<feature-slug>/specification.md`.

Keep sections that carry a real decision, and mark a standard concern `Not applicable` with a reason when omission would be ambiguous. Prefer interface and behaviour descriptions over speculative code or exhaustive file lists.

A concern an installed pack owns is decided in that pack's vocabulary: read the pack's skill before deciding it, so the specification and the implementation use the same words.

The test plan uses descriptive public boundaries, behaviours, and test levels. The requirements remain the source of product truth; link to them instead of duplicating them.
