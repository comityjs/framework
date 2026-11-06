---
"@comity/identity": patch
---

Throw `InvalidIdentifierError` from `User.snapshot()` when the user has no assigned ID instead of returning an invalid snapshot.
