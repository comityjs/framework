# @comity/order — Migration Guide: 0.9.3 → 0.10.0

> **Target release:** `@comity/order@0.10.0` with `@comity/pricing@0.10.0`.
> This is a migration guide, not a release announcement. **`0.10.0` is not
> published yet.** `@comity/order@0.9.3` and `@comity/pricing@0.9.3` are the
> current published baseline; they are the starting point for this guide.
>
> **Authority:** ADR-032 (including Amendments 1, 2 and 3), ADR-014
> (A14-1…A14-17), ADR-008/OD-8 and the accepted Order/Commerce boundary
> decision. The final contract is also summarised in `docs/overview.md`.

## 1. Scope

This guide covers the breaking migration from the published `0.9.3` order and
pricing contracts to the upcoming `0.10.0` contracts:

- `@comity/order`: `0.9.3` → `0.10.0` — **breaking** (a minor bump under 0.x,
  as required by ADR-032).
- `@comity/pricing`: `0.9.3` → `0.10.0` — additive pricing APIs and one new
  error reason; existing pricing APIs remain available.

There are no compatibility aliases. The old order contract cannot coexist with
the new one under the same names: `OrderData.items` becomes `lines`, and the
line element changes shape.

## 2. Published `0.9.3` baseline

The published declarations are the evidence for this section, not the current
source tree.

### `@comity/order@0.9.3`

- `OrderData.items: ReadonlyArray<OrderItem>`.
- `OrderItem { id, product: OrderProductSnapshot, quantity, price: Price, meta? }`.
- `OrderItemInput` was the input type for `addItem`.
- `OrderProductSnapshot { productId?, sku, name, variant?, attributes?, options?, metadata? }`.
- `OrderProductAttribute { code, label?, value }` and
  `OrderProductOption { code, label?, value }`.
- `OrderVariantSnapshot { id, sku?, name?, attributes?, options? }`.
- `OrderData.price: Price` (the transient pricing Value Object).
- `OrderState` had no `currency` and no `version`; it contained `items`.
- The constructor `new Order(fields, id)` was used both for creation and
  hydration. There was no validating `Order.create`.
- Mutations: `setItems`, `addItem`, `removeItem`, `updateItemQuantity`,
  `update({ price })`, `attachPayment`, `changeShippingDestination` and the
  lifecycle methods.
- `OrderUpdate { price?, meta? }`; `update()` returned `void`.
- `OrderCustomerSnapshot { customerId?, displayName, contacts?, capturedAt }`.
- Error reasons: `invalid_quantity`, `invalid_item`,
  `invalid_status_transition`, `shipping_destination_immutable`,
  `ambiguous_shipping_destination`, `duplicate_item_id`.
- `OrderRepository` already had `getById`, `save` (upsert) and `search`.

### `@comity/pricing@0.9.3`

- `Price` is transient: its total is computed by `Price.create`, and its state
  is private; it has no serialization or restoration contract.
- `PriceSnapshot` is a `Price` plus `capturedAt`; it is not a persistence form.
- `PriceModifier` is the live descriptor with a `money` or `percentage`
  adjustment and an explicit `add`/`subtract` operation.
- There is no `PriceRecord`, `PriceCurrency`, `PlainPriceRecord`,
  `PriceModifierRecord` or `PriceVerification` in `0.9.3`.
- `PricingError` reasons are the seven pre-existing reasons; there is no
  `unsupported_record_format`.

## 3. Target `0.10.0` contract

### Order data

```ts
interface OrderData {
  readonly lines: ReadonlyArray<OrderLine>;
  readonly price: PriceRecord; // no longer Price
  readonly currency: PriceCurrency; // required, also on empty orders
  readonly channelId: ChannelId;
  readonly customer?: OrderCustomerSnapshot;
  readonly addresses?: ReadonlyArray<OrderAddressSnapshot>;
  readonly payments?: ReadonlyArray<OrderPaymentSnapshot>;
  readonly meta?: Record<string, unknown>;
}

interface OrderLine {
  readonly lineId: string; // was OrderItem.id
  readonly subject: OrderLineSubject; // was OrderItem.product
  readonly quantity: number;
  readonly price: PriceRecord;
  readonly meta?: Record<string, unknown>;
}

interface OrderLineSubject {
  readonly reference?: string; // opaque, caller-owned
  readonly name: string;
  readonly description?: string;
}
```

### Buyer fact

`OrderCustomerSnapshot` remains generic and historical:
`{ customerId?, displayName, contacts?, capturedAt }`. There is no buyer
`kind`, `legalName` or `taxId` in generic Order, and no O-11 enforcement.
Commercial, billing, legal and fiscal coherence belongs to Commerce.

### Order lifecycle

- `Order.create(data, id)` is the validating creation path and returns
  `Result<Order, OrderError>`; a new order is `draft` with `version: 0`.
- The constructor is hydration-only: it performs no validation and restores
  `status`, timestamps and `version` verbatim.
- `setPricedContent(lines, adjustments)` is the single draft-only atomic
  replacement of lines and the derived order-level `PriceRecord`.
- `OrderUpdate` changes metadata only. `OrderUpdate.price` is gone.
- `submit()` re-derives the order record from the stored line records and
  stored order-level modifiers and requires exact commitment equality before
  leaving `draft`.
- `OrderState` has `lines`, `price`, `currency` and `version`; the repository
  surface (`getById`, `save`, `search`) is otherwise unchanged.

## 4. Migration procedure

The examples below use a small `unwrap` helper for brevity. Production code
should handle each failure explicitly; the comments identify the relevant
error paths.

```ts
import type { BaseError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";

function unwrap<T, E extends BaseError>(result: Result<T, E>): T {
  if (!result.success) {
    throw result.error;
  }
  return result.value;
}
```

### 4.1 Rename the collection and the element

1. Replace `OrderData.items` with `OrderData.lines`.
2. Replace `OrderItem` with `OrderLine`.
3. Replace `item.id` with `line.lineId`.
4. Replace `item.product` with `line.subject`.
5. Map the product identity and display name to the generic subject:
   `productId` (or another stable source reference) goes to the opaque
   `subject.reference`; `product.name` goes to `subject.name`; a display-only
   description may go to `subject.description`.
6. Move SKU, variant, attributes and selected options into a Commerce-owned
   type or into `line.meta`. They are **not** fields of the generic subject.
   The Order preserves them but does not understand or classify them.

The generic subject deliberately has no `kind`, `sku`, `variant` or `options`
fields. Commercial taxonomy belongs to Commerce, not to `@comity/order`.
The example assumes `legacyItems` is the application's existing
`ReadonlyArray<LegacyItem>`.

```ts
import type { OrderLine, OrderLineSubject } from "@comity/order";
import { PriceRecord } from "@comity/pricing";

interface LegacyProductSnapshot {
  readonly productId?: string;
  readonly sku: string;
  readonly name: string;
  readonly variant?: unknown;
  readonly attributes?: unknown;
  readonly options?: unknown;
  readonly metadata?: Record<string, unknown>;
}

interface LegacyItem {
  readonly id: string;
  readonly product: LegacyProductSnapshot;
  readonly quantity: number;
  readonly price: import("@comity/pricing").Price;
}

function toOrderLine(item: LegacyItem): OrderLine {
  const subject: OrderLineSubject = {
    ...(item.product.productId !== undefined ? { reference: item.product.productId } : {}),
    name: item.product.name,
  };

  return {
    lineId: item.id,
    subject,
    quantity: item.quantity,
    price: unwrap(PriceRecord.from(item.price)),
    meta: {
      commerce: {
        sku: item.product.sku,
        variant: item.product.variant,
        attributes: item.product.attributes,
        options: item.product.options,
        metadata: item.product.metadata,
      },
    },
  };
}
```

### 4.2 Replace line and order `Price` values with `PriceRecord`

7. Produce a line `PriceRecord` with `PriceRecord.from(price)`. The record
   stamps the current `format` and `semanticsId`; callers cannot choose either.
8. Produce the required order currency with
   `currentPriceCurrency(code)` for a **new** calculation. Do not derive it
   from a line or validate a historical record through it.
9. Produce the order-level record with
   `PriceRecord.combine(lineRecords, orderAdjustments)`. Line modifiers are
   provenance and are not reapplied; order adjustments are applied once, in
   order. `combine` requires at least one part.

```ts
import {
  Currency,
  Money,
  Percentage,
  Price,
  PriceRecord,
  calculatePrice,
  currentPriceCurrency,
} from "@comity/pricing";
import type { PriceModifier } from "@comity/pricing";

const eur = unwrap(Currency.create("EUR"));
const currency = unwrap(currentPriceCurrency("EUR"));

const base = unwrap(Money.create(2000n, eur)); // 20.00 EUR
const promotion: PriceModifier = {
  code: "promo-10",
  label: "Promotion",
  kind: "discount",
  component: "promotion",
  adjustment: {
    type: "percentage",
    rate: unwrap(Percentage.create(10n, 0)), // 10%
    operation: "subtract",
  },
};

const linePrice = unwrap(calculatePrice(base, [promotion]));
const lineRecord = unwrap(PriceRecord.from(linePrice));

const shipping: PriceModifier = {
  code: "shipping",
  label: "Shipping",
  kind: "charge",
  component: "shipping",
  adjustment: {
    type: "money",
    amount: unwrap(Money.create(500n, eur)),
    operation: "add",
  },
};

const lines = legacyItems.map(toOrderLine);
const orderPrice = unwrap(
  PriceRecord.combine(
    lines.map((line) => line.price),
    [shipping]
  )
);
```

### 4.3 Create the order through `Order.create`

10. Supply `currency`, the complete `lines`, and the order-level `price` to
    `Order.create`. The constructor must not be used to create a new order.

```ts
import { Order, OrderId } from "@comity/order";
import { ChannelId } from "@comity/organization";

const channelId = unwrap(ChannelId.create("web"));
const orderId = unwrap(OrderId.create("order-123"));

const created = Order.create({ lines, price: orderPrice, currency, channelId }, orderId);

if (!created.success) {
  // Handle OrderError: invalid_quantity, duplicate_item_id,
  // currency_mismatch, price_incoherent or payment_fact_conflict.
  throw created.error;
}

const order = created.value; // draft, version 0
```

### 4.4 Replace all priced-content mutations with `setPricedContent`

11. Replace `setItems`, `addItem`, `removeItem`, `updateItemQuantity` and
    `update({ price })` with one call that supplies the complete desired
    `lines` and order-level `adjustments`:
    `setPricedContent(lines, adjustments)`.
12. Remove price mutation from `update`. `OrderUpdate` has only `meta`.
13. The operation is allowed only in `draft`; it replaces lines and the
    derived order record atomically. A failure leaves the order unchanged.

```ts
const nextLines: OrderLine[] = lines; // the complete desired collection
const replaced = order.setPricedContent(nextLines, [shipping]);

if (!replaced.success) {
  // commitment_immutable outside draft; otherwise invalid_quantity,
  // duplicate_item_id, currency_mismatch or price_incoherent.
  throw replaced.error;
}
```

### 4.5 Submit and handle the result

14. `submit()` returns a `Result`; on failure the order stays `draft` and no
    stored record is altered. Reconciliation uses `PriceRecord.combine` and
    exact commitment equality; `verify()` is never used by Order.

```ts
const submitted = order.submit();
if (!submitted.success) {
  // invalid_status_transition, currency_mismatch or price_incoherent
  throw submitted.error;
}
```

### 4.6 Migrate `update` and payment attachment

15. `update()` and `attachPayment()` now return `Result`; branch on the result.
    `update` changes only metadata. `attachPayment` records an immutable
    historical fact and can return `payment_fact_conflict`.

```ts
const updated = order.update({ meta: { source: "checkout" } });
if (!updated.success) throw updated.error;

const payment = {
  amount: unwrap(Money.create(2500n, eur)),
  status: "authorized" as const,
};
const attached = order.attachPayment(payment);
if (!attached.success) {
  // payment_fact_conflict
  throw attached.error;
}
```

## 5. Empty orders and clearing priced content

An empty order is valid only with the **canonical zero record**:

- `subtotal = 0n`, `total = 0n`, no modifiers;
- supported `format` and current `semanticsId`;
- the same `(code, exponent)` as `OrderData.currency`.

Build it through `PriceRecord.from`; **never** call `combine([])`, which is
forbidden. Once an order has lines, `setPricedContent([], ...)` is rejected:
clearing all priced content is not a supported transition.

```ts
const zeroPrice = unwrap(Price.create(unwrap(Money.create(0n, eur)), []));
const emptyPrice = unwrap(PriceRecord.from(zeroPrice));

const emptyOrder = Order.create(
  { lines: [], price: emptyPrice, currency, channelId },
  unwrap(OrderId.create("empty-order-1"))
);
```

## 6. Exact price reconciliation

`Order.create` and `submit` require **exact commitment equality** between the
stored record and the record derived by `PriceRecord.combine`:

- `format` and `semanticsId` are equal;
- `currency.code` and `currency.exponent` are equal;
- `subtotal` and `total` are equal as exact integers;
- modifiers are equal **element by element, in their original order**, on
  `code`, `label` presence/value, `kind`, `component` presence/value,
  adjustment `type`, `operation`, and `amount` (money) or `amount` and `scale`
  (percentage).

Monetary equality alone is **not** sufficient. Modifiers are never
deduplicated, reordered or normalised by Order; equal totals with different
provenance are different commitments. Line modifiers are provenance of the
finalized line calculation: `combine` validates them but never reapplies or
copies them. Order-level adjustments are applied exactly once, in order.

A record with an older/unknown semantics id is not eligible for a new
commitment: a draft fails `submit` as `price_incoherent`; a committed
historical order remains readable and can be checked with
`PriceRecord.verify` (which is separate from commit eligibility).

## 7. Error migration

### Published and current reasons

The published `0.9.3` union had six reasons:

`invalid_quantity`, `invalid_item`, `invalid_status_transition`,
`shipping_destination_immutable`, `ambiguous_shipping_destination`,
`duplicate_item_id`.

The final `0.10.0` union has ten reasons: those six plus
`currency_mismatch`, `price_incoherent`, `commitment_immutable` and
`payment_fact_conflict`.

The four additions are the Phase A additions. `invalid_item` is retained in
the union for source compatibility; the current public priced-content and
lifecycle methods do not raise it.

| Failure                                                                                                  | Order error                            |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Quantity is not an integer `>= 1` (`create`, `setPricedContent`)                                         | `order:invalid_quantity`               |
| Duplicate `lineId` (`create`, `setPricedContent`)                                                        | `order:duplicate_item_id`              |
| Illegal lifecycle transition (`submit`, `confirm`, `fulfill`, `cancel`)                                  | `order:invalid_status_transition`      |
| Shipping destination cannot change in the current status                                                 | `order:shipping_destination_immutable` |
| No shipping destination, or more than one                                                                | `order:ambiguous_shipping_destination` |
| Currency `code` or `exponent` disagreement                                                               | `order:currency_mismatch`              |
| Record incoherence, empty `setPricedContent` lines, non-current semantics, or failed commitment equality | `order:price_incoherent`               |
| Priced-content mutation outside `draft`                                                                  | `order:commitment_immutable`           |
| Supplied or attached payment fact conflicts with recorded facts                                          | `order:payment_fact_conflict`          |

`invalid_buyer` is **not** in the published `0.9.3` union and is not in the
final `0.10.0` union. It existed only in an unreleased intermediate design.

### Pricing failures and commitment failures

Pricing failures never escape from Order as `PricingError`: a currency
`code`/`exponent` disagreement maps to `order:currency_mismatch`; every other
Pricing failure on a priced path maps to `order:price_incoherent`. The Order
does not reimplement pricing arithmetic or modifier semantics.

`commitment_immutable` is a lifecycle error, not a pricing error: it means
the order is not `draft`. `payment_fact_conflict` is a historical-fact error,
not a pricing error: it means the payment fact contradicts O-9.

`create` handles `invalid_quantity`, `duplicate_item_id`, `currency_mismatch`,
`price_incoherent` and `payment_fact_conflict`. `setPricedContent` handles
`commitment_immutable`, `invalid_quantity`, `duplicate_item_id`,
`currency_mismatch` and `price_incoherent`. `submit` handles
`invalid_status_transition`, `currency_mismatch` and `price_incoherent`.
`update` returns a `Result`, but the current metadata-only path has no domain
failure case. `attachPayment` handles `payment_fact_conflict`.

## 8. Persistence and hydration outline

Persist records as `PlainPriceRecord` created by `PriceRecord.toPlain` and
restore them with `PriceRecord.restore`. **Do not** pass a live `PriceRecord`
to `JSON.stringify`: monetary amounts are `bigint` and the percentage rate is a
class instance. The plain form stores monetary amounts as decimal strings and
percentages as `(amount, scale)`.

```ts
import type { PlainPriceRecord, PriceCurrency } from "@comity/pricing";
import { PriceRecord } from "@comity/pricing";
import type { OrderLine, OrderLineSubject, OrderStatus } from "@comity/order";
import { Order, OrderId } from "@comity/order";
import type { ChannelId } from "@comity/organization";
import type { Instant } from "@comity/primitives/time";

interface StoredLine {
  readonly lineId: string;
  readonly subject: OrderLineSubject;
  readonly quantity: number;
  readonly price: PlainPriceRecord;
  readonly meta?: Record<string, unknown>;
}

interface StoredOrder {
  readonly id: string;
  readonly lines: ReadonlyArray<StoredLine>;
  readonly price: PlainPriceRecord;
  readonly currency: PriceCurrency;
  readonly channelId: ChannelId;
  readonly status: OrderStatus;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly version: number;
}

function toStored(order: Order): StoredOrder {
  return {
    id: order.id.toString(),
    lines: order.lines.map((line) => ({
      lineId: line.lineId,
      subject: line.subject,
      quantity: line.quantity,
      price: PriceRecord.toPlain(line.price),
      ...(line.meta !== undefined ? { meta: line.meta } : {}),
    })),
    price: PriceRecord.toPlain(order.price),
    currency: order.currency,
    channelId: order.channelId,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    version: order.version,
  };
}

function fromStored(stored: StoredOrder): Order {
  const lines: OrderLine[] = stored.lines.map((line) => ({
    ...line,
    price: unwrap(PriceRecord.restore(line.price)),
  }));

  return new Order(
    {
      lines,
      price: unwrap(PriceRecord.restore(stored.price)),
      currency: stored.currency,
      channelId: stored.channelId,
      status: stored.status,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      version: stored.version,
    },
    unwrap(OrderId.create(stored.id))
  );
}
```

The outline covers the priced state. Persist `customer`, `addresses`,
`payments` and order `meta` alongside it using their existing field mappings;
`OrderPaymentSnapshot.amount` is a `Money` and needs an explicit amount +
currency mapping (there is no `Money.toPlain`).

Hydration must use the constructor, not `Order.create`, and must not call
`combine`, `verify` or any pricing arithmetic. Restore is structural only:
it never checks the current ISO table, never recomputes totals and never
repairs a value. Persist lines and the order record in one transaction; a
`setPricedContent` replacement is atomic in memory and the adapter must keep
it atomic on disk. Historical committed orders remain loadable even when their
currency or `semanticsId` is no longer current.

### Existing `0.9.3` price data

Published `@comity/pricing@0.9.3` has no `PriceRecord`, and `Price` has no
serialization or restoration contract. There is therefore **no generic
conversion from a persisted `0.9.3` `Price`**. If your adapter persisted a
custom representation of `Price`, treat its migration as an adapter-specific
data migration:

- preserve the recorded subtotal, total, ordered modifiers and provenance;
- do **not** call `Price.create`/`PriceRecord.from` to silently recompute a
  historical total and label it with the current `semanticsId`;
- decide explicitly which historical semantics identifier describes the old
  data; `PriceRecord.from` and `combine` can only stamp the current one;
- if the old representation cannot be mapped losslessly, keep it as historical
  adapter data rather than fabricating a record.

This is separate from the code migration: new calculations use the current
pricing engine and produce current records; historical committed amounts must
not be rewritten or re-priced.

## 9. If you adopted the unreleased intermediate Phase A build

The five-kind `OrderLineSubjectSnapshot`, optional `priceBasis` and
`OrderLineTerm`, the four line mutators (`setLines`, `addLine`, `removeLine`,
`updateLineQuantity`), `OrderUpdate.price`, four-mutator error behaviour and
`invalid_buyer` were part of an **unreleased intermediate design**. They were
never part of published `@comity/order@0.9.3` and are not part of the final
`0.10.0` contract.

- If you are migrating from published `0.9.3`, do **not** add these fields or
  methods just to remove them again. Go directly to the final contract.
- If you adopted an intermediate development build, migrate directly to the
  final contract. Do not treat the intermediate design as a published
  compatibility baseline.
- Buyer `kind`/`legalName`/`taxId` and O-11 are Commerce policy, not generic
  Order fields or invariants. If you added them in an intermediate build,
  remove them from the generic order and enforce the policy at the Commerce
  boundary.
- `priceBasis`/`term` and the commercial subject taxonomy belong to Commerce.
  Preserve any needed data in a Commerce-owned type or `line.meta`.

The current authority is **ADR-032 Amendment 3**, the accepted
`order-commerce-boundary-decision.md`, ADR-014 and the current public
contract in `docs/overview.md`.

## 10. Migration checklist

- [ ] Rename `items` → `lines`, `OrderItem` → `OrderLine`, `id` → `lineId`,
      `product` → `subject`.
- [ ] Move SKU/variant/options/attributes into Commerce-owned data or
      `line.meta`; keep `subject.reference` opaque and `subject.name`
      renderable.
- [ ] Replace every line and order `Price` with `PriceRecord`; create line
      records with `PriceRecord.from`.
- [ ] Supply `OrderData.currency` from `currentPriceCurrency` for new work.
- [ ] Build the order record with `PriceRecord.combine`; use
      `PriceRecord.from` for the canonical zero record of an empty order.
- [ ] Never call `combine([])`; never call `setPricedContent([], ...)`.
- [ ] Replace all line/price mutation with `setPricedContent`; remove
      `update({ price })`.
- [ ] Use `Order.create` for creation and the constructor only for hydration.
- [ ] Handle all `Result` values and the current ten error reasons; remove
      `invalid_buyer` handling only if it came from an intermediate build.
- [ ] Persist with `PriceRecord.toPlain`; hydrate with
      `PriceRecord.restore`; never recompute or reprice on load.
- [ ] Store lines and the order record atomically; restore `status`,
      timestamps and `version` verbatim.
- [ ] Run `submit()` in a draft and handle `currency_mismatch` /
      `price_incoherent` before expecting `pending`.

`0.10.0` is the target of this guide and is not published at the time of
writing. The published baseline remains `0.9.3`.
