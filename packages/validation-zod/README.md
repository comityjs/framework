# @comity/validation-zod

Zod adapter for @comity/validation contracts.

---

## Purpose

Implements the `Validator` contract defined by `@comity/validation` using Zod schemas. Enables applications to validate domain data with Zod while depending only on the Comity validation contract.

---

## Scope

This package:

- ✅ implements the `Validator` contract
- ✅ provides `ZodValidator`, a Zod-schema-backed validator
- ✅ maps Zod errors to Comity validation errors
- ✅ depends only on `@comity/primitives` and `@comity/validation`

This package does NOT:

- ❌ define validation contracts
- ❌ provide framework-independent validation logic
- ❌ depend on any Comity core module beyond `@comity/validation`

---

## Public API

- `ZodValidator` — validator implementing `Validator<T>` from a `ZodType<T>` schema


No exhaustive reference; see docs for constraints.
---

## Documentation

None — no package-specific documentation exists.

---

## Related Packages

- @comity/validation — defines the `Validator` contract this adapter implements
- @comity/primitives — foundational `Result` types used by the contract

---

## Status

Experimental
