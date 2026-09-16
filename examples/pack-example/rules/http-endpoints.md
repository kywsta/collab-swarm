---
paths:
  - "src/**/routes/**"
  - "src/**/handlers/**"
  - "src/**/api/**"
description: Invariants for HTTP endpoints — validation at the edge, one failure mapping, contract-shaped responses.
---

# HTTP endpoint rule

Recipe: [`http-endpoint`](../skills/http-endpoint/SKILL.md).

- Validate at the edge and reject with the documented status before doing any work.
- Map a domain failure onto its status in one place; two endpoints must not disagree about what a missing record means.
- Return the response type the contract names. A storage type reaching a client leaks the schema and breaks on the next migration.
- Every status the contract documents is tested, or the test plan says why it is unreachable.
