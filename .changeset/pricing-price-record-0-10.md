---
"@comity/pricing": minor
---

Add the accepted `PriceRecord` historical-record contract: `PriceRecord`,
`PriceCurrency`, `PlainPriceRecord`, `PriceModifierRecord`,
`PriceVerification` and `currentPriceCurrency`, with `from`, `combine`,
`toPlain`, `restore` and `verify`. Records preserve currency and amount
provenance losslessly and separate structural restoration from historical
verification and current commit eligibility. Adds the
`unsupported_record_format` reason. Existing pricing APIs remain available.
