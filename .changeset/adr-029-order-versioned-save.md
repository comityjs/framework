---
"@comity/order": minor
---

Implement the ADR-029 versioned repository contract. `OrderRepository.save` is now a compare-and-set on the aggregate version and returns `repository:conflict` for stale or duplicate writes, with no retry. Add `MemoryOrderStore` for shared in-memory persistence.
