# Ticket format

Start from the shared [ticket template](../../workflow/templates/ticket.md). Write each ticket to `<plans>/<feature-slug>/tickets/<ticket-slug>.md`.

The filename is the ticket identity. Frontmatter contains only `title`, `status`, `depends_on`, and `skills`. Dependencies name other ticket slugs.

`skills` accepts only skills whose role is *implements a ticket*; run `npx swarm packs` to list them. Coordination skills and reference skills are read, never scheduled, and the validator rejects them here.

Link or quote descriptive requirement names where useful. The body states the outcome, relevant requirements, implementation constraints, behaviour tests and checks, and a concrete done condition. Keep ordinary implementation discoveries in code; update the specification when a load-bearing decision changes.
