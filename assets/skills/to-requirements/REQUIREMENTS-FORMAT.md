# Requirements format

Start from the shared [requirements template](../../workflow/templates/requirements.md). Write it to `<plans>/<feature-slug>/requirements.md`.

## Product behaviour

Use descriptive story and criterion names. Acceptance criteria should be observable and usually follow Given/When/Then. Cover success, empty, error, recovery, privacy, accessibility, and permission states when they affect the user.

## Sources

One row per source actually read. Name the repository path and the exact heading, then summarise the details used so a reviewer does not have to infer why the section is relevant. A configured source this feature did not need gets a row saying `Not applicable` and why.

## Interfaces

One row per surface the feature presents. A surface is anything outside the feature can reach: a screen, a command, an endpoint it exposes, an event it publishes. A service with no rendered interface lists its operations and events here rather than writing `None`. When a design source is configured, cite the index path, the matching rows, and the node references, plus why those nodes are needed. Name the states each surface must render; a load failure is never the same row as an empty result.

## Data and integrations

For a local contract, cite the file plus method and route or operation name. For a contract exposed through a connected server, cite the server or resource plus the operation name. Include only what this feature requires. An operation that exists in no contract is recorded here with its source marked missing, and again under open questions as a gate — unless the source is `owned: true`, when the operation this feature defines is recorded here with the shape it will have and the contract file it lands in, and is not a gate at all.

## Open questions

Write a direct question when the sources are missing or contradictory. Product questions block technical planning; a missing external dependency does not, because the feature is planned around it. A concern that does not apply gets a short reason instead of an empty section.
