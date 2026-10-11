---
description: Implement a GitHub issue end-to-end
argument-hint: "<issue-number>"
---
# Pi Implementation Prompt

The implementation issue number is `$1`.

```text
Implement GitHub issue #$1.

Reconstruct the authoritative context from the current repository, `AGENTS.md`,
issue #$1, its parent spec, and any relevant `CONTEXT.md` / ADRs referenced by
them.

Implement only the approved scope of the issue.

Use the repository's existing conventions and verification commands. Use
Playwright CLI when browser-level verification is relevant.

Do not invent unresolved product behavior, domain semantics, permissions/policy,
persistence semantics, substantial scope expansion, or material architecture
decisions. If implementation reaches one of those decisions, preserve the
current local state and return with the evidence and the decision that needs
resolution.

Before finishing:
- reread the implementation issue and parent spec against the resulting diff;
- fix any missed acceptance criteria or accidental scope changes;
- run the relevant verification;
- inspect the final diff.

Return:
- concise change summary;
- commit / PR if created;
- exact verification commands and results;
- acceptance-criteria evidence;
- any unrelated failures;
- any remaining concerns or unresolved decisions.
```
