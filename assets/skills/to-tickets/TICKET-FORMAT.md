# Ticket format

Start from the shared [ticket template](../../workflow/templates/ticket.md). Write each ticket to `<plans>/<feature-slug>/tickets/<ticket-slug>.md`.

The filename is the ticket identity. Frontmatter contains only `title`, `status`, `depends_on`, `skills`, and — in a hub — `repository`. Dependencies name other ticket slugs.

`repository` names the code repository the ticket is built in, from the plan's `repositories:`. It is required when the plan lists more than one; a ticket never spans two, so an endpoint and the screen calling it are two tickets with a dependency between them.

`skills` accepts only skills whose role is *implements a ticket*; run `npx collab-swarm packs` to list them. Coordination skills and reference skills are read, never scheduled, and the validator rejects them here.

Link or quote descriptive requirement names where useful. The body states the outcome, relevant requirements, implementation constraints, behaviour tests and checks, and a concrete done condition. Keep ordinary implementation discoveries in code; update the specification when a load-bearing decision changes.
