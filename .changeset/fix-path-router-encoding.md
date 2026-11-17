---
"@comity/router-path-to-regexp": patch
---

Fix `PathRouter` percent-encoding handling. Routes with literal non-ASCII characters or spaces (`/café`, `/a b`) now match the percent-encoded `URL.pathname`, and a parameter that is not valid percent-encoding (`/user/100%`, `/user/%ZZ`) no longer rejects `match()` with `URIError`: the route simply does not match, so the request resolves to `null` (404) instead of aborting the pipeline with a 500.
