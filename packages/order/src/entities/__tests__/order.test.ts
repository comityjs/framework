import type { PriceCurrency, PriceModifier } from "@comity/pricing";
import type { OrderAddressSnapshot } from "../../contracts/address-snapshot.js";
import type { OrderCustomerSnapshot } from "../../contracts/customer-snapshot.js";
import type { OrderLine, OrderLineSubject } from "../../contracts/line.js";
import type { OrderCreate, OrderData } from "../../contracts/order.js";
import type { OrderPaymentSnapshot } from "../../contracts/payment-snapshot.js";

import { ChannelId } from "@comity/organization";
import { Currency, Money, Percentage, Price, PriceRecord } from "@comity/pricing";
import { Instant } from "@comity/primitives/time";
import { isFailure, isSuccess } from "@comity/primitives/result";
import { describe, expect, it } from "vitest";
import { OrderId } from "../../value-objects/order-id.js";
import { Order } from "../order.js";

function unwrap<T>(result: { success: true; value: T } | { success: false }): T {
  if (isFailure(result)) {
    throw new Error("Unexpected failure");
  }

  return result.value;
}

const eur = unwrap(Currency.create("EUR"));
const usd = unwrap(Currency.create("USD"));
const money = (amount: bigint, currency = eur): Money => unwrap(Money.create(amount, currency));
const pct = (amount: bigint, scale = 0): Percentage => unwrap(Percentage.create(amount, scale));
const price = (
  amount: bigint,
  modifiers: ReadonlyArray<PriceModifier> = [],
  currency = eur
): Price => unwrap(Price.create(money(amount, currency), modifiers));

const priceCurrency = (currency = eur): PriceCurrency => ({
  code: currency.code,
  exponent: currency.exponent,
});

const record = (
  amount: bigint,
  modifiers: ReadonlyArray<PriceModifier> = [],
  currency = eur
): PriceRecord => unwrap(PriceRecord.from(price(amount, modifiers, currency)));

const id = unwrap(OrderId.create("order-1"));
const channelId = unwrap(ChannelId.create("web"));

const subject: OrderLineSubject = {
  reference: "offering-1",
  name: "T-shirt",
  description: "Blue cotton",
};

const line = (
  lineId = "line-1",
  quantity = 1,
  linePrice: PriceRecord = record(1000n),
  lineSubject: OrderLineSubject = subject
): OrderLine => ({ lineId, subject: lineSubject, quantity, price: linePrice });

const moneyAdjustment = (
  code: string,
  value: bigint,
  operation: "add" | "subtract" = "add",
  kind: PriceModifier["kind"] = "charge"
): PriceModifier => ({
  code,
  kind,
  adjustment: { type: "money", amount: money(value), operation },
});

const percentAdjustment = (
  code: string,
  value: bigint,
  operation: "add" | "subtract" = "add",
  scale = 0,
  kind: PriceModifier["kind"] = "tax"
): PriceModifier => ({
  code,
  kind,
  adjustment: { type: "percentage", rate: pct(value, scale), operation },
});

const derive = (
  lines: ReadonlyArray<OrderLine>,
  adjustments: ReadonlyArray<PriceModifier | PriceRecord["modifiers"][number]> = []
): PriceRecord =>
  unwrap(
    PriceRecord.combine(
      lines.map((candidate) => candidate.price),
      adjustments
    )
  );

function data(overrides: Partial<OrderData> = {}): OrderData {
  const lines = overrides.lines ?? [line()];
  const currency = overrides.currency ?? priceCurrency();
  const priceValue = overrides.price ?? (lines.length === 0 ? record(0n, [], eur) : derive(lines));

  return { lines, price: priceValue, currency, channelId, ...overrides };
}

function createOrder(overrides: Partial<OrderData> = {}): Order {
  return unwrap(Order.create(data(overrides), id));
}

function hydrate(overrides: Partial<OrderCreate> = {}): Order {
  return new Order({ ...data(), ...overrides }, id);
}

const capturedAt = Instant.fromEpochMilliseconds(111111);
const customer: OrderCustomerSnapshot = {
  customerId: "cust-1",
  displayName: "Jane Doe",
  contacts: [{ type: "email", value: "jane@example.com" }],
  capturedAt,
};
const address: OrderAddressSnapshot = {
  addressId: "addr-1",
  role: "shipping",
  lines: ["1 Main St"],
  city: "Rome",
  administrativeArea: "RM",
  postalCode: "00100",
  countryCode: "IT",
  capturedAt,
};

function receipt(
  paymentId: string | undefined,
  status: OrderPaymentSnapshot["status"],
  total = 10000n
): OrderPaymentSnapshot {
  return {
    ...(paymentId !== undefined ? { paymentId } : {}),
    amount: money(total),
    status,
  };
}

/**
 * Returns a zero-valued record whose only difference from the canonical zero
 * record is modifier provenance (a zero-amount adjustment with label, kind and
 * component). Every monetary value is identical.
 *
 * @returns The provenance-only zero record.
 */
function zeroWithProvenanceModifier(): PriceRecord {
  return {
    ...record(0n),
    modifiers: [
      {
        code: "zero-fee",
        label: "Zero fee",
        kind: "charge",
        component: "promotion",
        adjustment: { type: "money", amount: 0n, operation: "add" },
      },
    ],
  };
}

describe("Order", () => {
  describe("Order.create — priced content (AM-5a)", () => {
    it("creates a draft order with version 0 and the supplied content", () => {
      const order = createOrder();

      expect(order.status).toBe("draft");
      expect(order.version).toBe(0);
      expect(order.currency).toEqual(priceCurrency());
      expect(order.price).toEqual(record(1000n));
      expect(order.lines).toHaveLength(1);
      expect(order.lines[0]?.lineId).toBe("line-1");
      expect(order.channelId.toString()).toBe("web");
    });

    it("records order-level adjustments once and does not copy line modifiers", () => {
      const pricedLine = line("line-1", 1, record(1000n, [moneyAdjustment("line-fee", 500n)]));
      const adjustment = percentAdjustment("order-fee", 10n);
      const priceValue = derive([pricedLine], [adjustment]);
      const order = createOrder({ lines: [pricedLine], price: priceValue });

      expect(pricedLine.price.total).toBe(1500n);
      expect(order.price.subtotal).toBe(1500n);
      expect(order.price.total).toBe(1650n);
      expect(order.price.modifiers.map((modifier) => modifier.code)).toEqual(["order-fee"]);
    });

    it("accepts the canonical zero record for an empty order", () => {
      const order = createOrder({ lines: [], price: record(0n) });

      expect(order.lines).toEqual([]);
      expect(order.price.subtotal).toBe(0n);
      expect(order.price.total).toBe(0n);
      expect(order.price.modifiers).toEqual([]);
    });

    it("rejects a non-zero empty order price", () => {
      for (const priceValue of [record(1n), record(0n, [moneyAdjustment("fee", 100n)])]) {
        const result = Order.create(data({ lines: [], price: priceValue }), id);

        expect(isFailure(result)).toBe(true);
        if (isFailure(result)) {
          expect(result.error.code).toBe("order:price_incoherent");
        }
      }
    });

    it("rejects an empty record whose only difference is modifier provenance", () => {
      /*
       * AM-5a derives a non-empty order from the supplied modifier list, so a
       * provenance-only divergence cannot be constructed there. The zero-record
       * rule is the reachable boundary where identical monetary values with
       * different modifier provenance must be rejected.
       */
      const canonical = record(0n);
      const supplied = zeroWithProvenanceModifier();

      expect(supplied.subtotal).toBe(canonical.subtotal);
      expect(supplied.total).toBe(canonical.total);
      expect(supplied.modifiers).toHaveLength(1);

      const result = Order.create(data({ lines: [], price: supplied }), id);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:price_incoherent");
      }
    });

    it("rejects an empty order price in another currency", () => {
      const result = Order.create(
        data({ lines: [], price: record(0n, [], usd), currency: priceCurrency() }),
        id
      );

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:currency_mismatch");
      }
    });

    it("rejects an empty order whose record has an unknown semantics identifier", () => {
      const tampered: PriceRecord = { ...record(0n), semanticsId: 999 };
      const result = Order.create(data({ lines: [], price: tampered }), id);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:price_incoherent");
      }
    });

    it("rejects a line whose currency code differs from the order currency", () => {
      const result = Order.create(data({ lines: [line("line-1", 1, record(1000n, [], usd))] }), id);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:currency_mismatch");
      }
    });

    it("rejects a line whose currency exponent differs from the order currency", () => {
      const result = Order.create(data({ currency: { code: "EUR", exponent: 3 } }), id);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:currency_mismatch");
      }
    });

    it("rejects a supplied order record whose currency differs from the order currency", () => {
      const result = Order.create(data({ price: record(1000n, [], usd) }), id);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:currency_mismatch");
      }
    });

    it("rejects a supplied record that is not commitment-equal to the derived record", () => {
      const lines = [line()];
      const cases: ReadonlyArray<PriceRecord> = [
        { ...derive(lines), total: 1001n },
        { ...derive(lines), subtotal: 999n },
        { ...derive(lines), semanticsId: 999 },
        { ...derive(lines), format: 2 as unknown as 1 },
      ];

      for (const priceValue of cases) {
        const result = Order.create(data({ lines, price: priceValue }), id);

        expect(isFailure(result)).toBe(true);
        if (isFailure(result)) {
          expect(result.error.code).toBe("order:price_incoherent");
        }
      }
    });

    it("rejects malformed or non-current line records through combine", () => {
      const cases: ReadonlyArray<PriceRecord> = [
        { ...record(1000n), format: 2 as unknown as 1 },
        { ...record(1000n), semanticsId: 999 },
        { ...record(1000n), total: 1001n },
      ];

      for (const linePrice of cases) {
        const result = Order.create(
          data({ lines: [line("line-1", 1, linePrice)], price: record(1000n) }),
          id
        );

        expect(isFailure(result)).toBe(true);
        if (isFailure(result)) {
          expect(result.error.code).toBe("order:price_incoherent");
        }
      }
    });

    it("rejects invalid quantities and duplicate line ids", () => {
      const badQuantity = Order.create(data({ lines: [line("line-1", 0)] }), id);
      const duplicate = Order.create(data({ lines: [line("line-1"), line("line-1")] }), id);

      expect(isFailure(badQuantity) && badQuantity.error.code).toBe("order:invalid_quantity");
      expect(isFailure(duplicate) && duplicate.error.code).toBe("order:duplicate_item_id");
    });

    it("validates supplied payment facts (O-9)", () => {
      const legal = createOrder({
        payments: [receipt("pay-1", "authorized"), receipt("pay-1", "captured")],
      });
      const illegal = Order.create(
        data({ payments: [receipt("pay-1", "captured"), receipt("pay-1", "authorized")] }),
        id
      );

      expect(legal.payments).toHaveLength(2);
      expect(isFailure(illegal) && illegal.error.code).toBe("order:payment_fact_conflict");
    });
  });

  describe("generic snapshots and hydration", () => {
    it("round-trips the generic line subject without any commercial taxonomy", () => {
      const order = createOrder({
        lines: [line("line-1", 2, record(2000n), { name: "Consulting hour" })],
        price: record(2000n),
      });
      const stored = order.lines[0]?.subject;

      expect(stored).toEqual({ name: "Consulting hour" });
      expect(Object.keys(stored ?? {}).sort()).toEqual(["name"]);
      expect(order.lines[0]?.quantity).toBe(2);
    });

    it("stores generic customer facts only", () => {
      const order = createOrder({ customer });

      expect(order.customer).toEqual(customer);
      expect(order.customer).not.toHaveProperty("kind");
      expect(order.customer).not.toHaveProperty("legalName");
      expect(order.customer).not.toHaveProperty("taxId");
    });

    it("restores status, timestamps, version and currency verbatim", () => {
      const createdAt = Instant.fromEpochMilliseconds(1000);
      const updatedAt = Instant.fromEpochMilliseconds(2000);
      const order = hydrate({
        status: "confirmed",
        createdAt,
        updatedAt,
        version: 7,
      });

      expect(order.status).toBe("confirmed");
      expect(order.createdAt.epochMilliseconds).toBe(1000);
      expect(order.updatedAt.epochMilliseconds).toBe(2000);
      expect(order.version).toBe(7);
      expect(order.currency).toEqual(priceCurrency());
    });

    it("performs no validation during hydration", () => {
      const incoherent: PriceRecord = { ...record(1000n), total: 1001n };
      const order = hydrate({ price: incoherent });

      expect(order.price).toEqual(incoherent);
    });

    it("returns defensive copies of lines, subjects and metadata", () => {
      const input = line("line-1", 1, record(1000n), { name: "Original" });
      const order = createOrder({ lines: [input] });
      input.subject.name = "Mutated";

      const fetched = order.lines;
      fetched[0]!.subject.name = "Mutated again";

      expect(order.lines[0]?.subject.name).toBe("Original");
    });

    it("defensively copies the stored price record", () => {
      const input = record(1000n);
      const order = createOrder({ price: input });
      const exposed = order.price as { currency: { code: string } };

      exposed.currency.code = "USD";

      expect(order.price.currency.code).toBe("EUR");
      expect(order.price.total).toBe(1000n);
    });

    it("defensively copies nested modifier data of the supplied record", () => {
      const input = record(1000n, [moneyAdjustment("fee", 500n)]);
      const before = PriceRecord.toPlain(input);
      const order = createOrder({ price: input });
      const adjustment = input.modifiers[0]?.adjustment;

      if (adjustment?.type === "money") {
        Object.assign(adjustment, { amount: 1n });
      }

      expect(PriceRecord.toPlain(order.price)).toEqual(before);
      expect(order.price.total).toBe(1500n);
      expect(PriceRecord.verify(order.price)).toEqual({ outcome: "verified" });
    });

    it("preserves the supplied line order and keys", () => {
      const order = createOrder({
        lines: [line("b", 1, record(100n)), line("a", 1, record(200n))],
        price: record(300n),
      });

      expect(order.lines.map((candidate) => candidate.lineId)).toEqual(["b", "a"]);
      expect(order.price.subtotal).toBe(300n);
    });
  });

  describe("setPricedContent (AM-5b)", () => {
    it("atomically replaces lines and the derived order record", () => {
      const created = Instant.fromEpochMilliseconds(1000);
      const order = hydrate({ createdAt: created, updatedAt: created });
      const pricedLine = line(
        "a",
        2,
        record(1000n, [percentAdjustment("line-promo", 10n, "subtract")])
      );
      const plainLine = line("b", 1, record(2000n));
      const fee = percentAdjustment("fee", 10n);

      const result = order.setPricedContent([pricedLine, plainLine], [fee]);

      expect(isSuccess(result)).toBe(true);
      expect(order.lines.map((candidate) => candidate.lineId)).toEqual(["a", "b"]);
      expect(order.lines[0]?.quantity).toBe(2);
      expect(order.price.subtotal).toBe(2900n);
      expect(order.price.total).toBe(3190n);
      expect(order.price.modifiers.map((modifier) => modifier.code)).toEqual(["fee"]);
      expect(order.updatedAt.epochMilliseconds).toBeGreaterThan(1000);
      expect(order.currency).toEqual(priceCurrency());
    });

    it("applies order adjustments exactly once, in the supplied order", () => {
      const fee = percentAdjustment("fee", 10n);
      const coupon = moneyAdjustment("coupon", 500n, "subtract");
      const first = hydrate();
      const second = hydrate();

      expect(isSuccess(first.setPricedContent([line("a", 1, record(2400n))], [fee, coupon]))).toBe(
        true
      );
      expect(isSuccess(second.setPricedContent([line("a", 1, record(2400n))], [coupon, fee]))).toBe(
        true
      );

      expect(first.price.total).toBe(2140n);
      expect(second.price.total).toBe(2090n);
      expect(first.price.modifiers.map((modifier) => modifier.code)).toEqual(["fee", "coupon"]);
      expect(second.price.modifiers.map((modifier) => modifier.code)).toEqual(["coupon", "fee"]);
    });

    it("accepts an empty adjustment list", () => {
      const order = hydrate();

      const result = order.setPricedContent([line("a", 1, record(1234n))], []);

      expect(isSuccess(result)).toBe(true);
      expect(order.price.subtotal).toBe(1234n);
      expect(order.price.total).toBe(1234n);
      expect(order.price.modifiers).toEqual([]);
    });

    it("rejects empty priced content and leaves the aggregate unchanged", () => {
      const order = hydrate();
      const before = { lines: order.lines, price: order.price, updatedAt: order.updatedAt };

      const result = order.setPricedContent([], []);

      expect(isFailure(result) && result.error.code).toBe("order:price_incoherent");
      expect(order.lines).toEqual(before.lines);
      expect(order.price).toEqual(before.price);
      expect(order.updatedAt.epochMilliseconds).toBe(before.updatedAt.epochMilliseconds);
    });

    it("rejects quantity and line-id violations without partial mutation", () => {
      const order = hydrate();
      const before = { lines: order.lines, price: order.price };
      const badQuantity = order.setPricedContent([line("a", 0, record(1000n))], []);
      const duplicate = order.setPricedContent(
        [line("a", 1, record(100n)), line("a", 1, record(200n))],
        []
      );

      expect(isFailure(badQuantity) && badQuantity.error.code).toBe("order:invalid_quantity");
      expect(isFailure(duplicate) && duplicate.error.code).toBe("order:duplicate_item_id");
      expect(order.lines).toEqual(before.lines);
      expect(order.price).toEqual(before.price);
    });

    it("rejects lines whose currency code or exponent differs from the order currency", () => {
      const order = hydrate();
      const codeResult = order.setPricedContent([line("a", 1, record(1000n, [], usd))], []);
      const exponentResult = order.setPricedContent(
        [line("a", 1, { ...record(1000n), currency: { code: "EUR", exponent: 3 } })],
        []
      );
      const usdAdjustment: PriceModifier = {
        code: "fee",
        kind: "charge",
        adjustment: { type: "money", amount: money(100n, usd), operation: "add" },
      };
      const adjustmentResult = order.setPricedContent(
        [line("a", 1, record(1000n))],
        [usdAdjustment]
      );

      expect(isFailure(codeResult) && codeResult.error.code).toBe("order:currency_mismatch");
      expect(isFailure(exponentResult) && exponentResult.error.code).toBe(
        "order:currency_mismatch"
      );
      expect(isFailure(adjustmentResult) && adjustmentResult.error.code).toBe(
        "order:currency_mismatch"
      );
    });

    it("maps every other Pricing failure to price_incoherent", () => {
      const order = hydrate();
      const cases: ReadonlyArray<PriceRecord> = [
        { ...record(1000n), format: 2 as unknown as 1 },
        { ...record(1000n), semanticsId: 999 },
        { ...record(1000n), total: 1001n },
      ];

      for (const linePrice of cases) {
        const outcome = order.setPricedContent([line("a", 1, linePrice)], []);

        expect(isFailure(outcome) && outcome.error.code).toBe("order:price_incoherent");
      }

      const zeroRate = order.setPricedContent(
        [line("a", 1, record(1000n))],
        [percentAdjustment("zero", 0n)]
      );

      expect(isFailure(zeroRate) && zeroRate.error.code).toBe("order:price_incoherent");
    });

    it("leaves the aggregate completely unchanged on any failure", () => {
      const order = hydrate();
      const before = { lines: order.lines, price: order.price, updatedAt: order.updatedAt };

      order.setPricedContent([line("a", 0, record(1000n))], []);
      order.setPricedContent([line("a", 1, record(1000n, [], usd))], []);
      order.setPricedContent(
        [{ ...record(1000n), total: 1001n }].map((p) => line("a", 1, p)),
        []
      );

      expect(order.lines).toEqual(before.lines);
      expect(order.price).toEqual(before.price);
      expect(order.updatedAt.epochMilliseconds).toBe(before.updatedAt.epochMilliseconds);
    });

    it("defensively copies the supplied lines", () => {
      const order = hydrate();
      const supplied = line("a", 1, record(1000n), { name: "Original" });

      expect(isSuccess(order.setPricedContent([supplied], []))).toBe(true);
      supplied.subject.name = "Mutated";

      expect(order.lines[0]?.subject.name).toBe("Original");
      expect(order.version).toBe(0);
    });
  });

  describe("lifecycle, submit reconciliation and error mapping", () => {
    const lockedStatuses = ["pending", "confirmed", "fulfilled", "cancelled"] as const;

    it.each(lockedStatuses)("rejects setPricedContent outside draft when %s", (status) => {
      const order = hydrate({ status });
      const before = { lines: order.lines, price: order.price };

      const result = order.setPricedContent([line("a", 1, record(2000n))], []);

      expect(isFailure(result) && result.error.code).toBe("order:commitment_immutable");
      expect(order.lines).toEqual(before.lines);
      expect(order.price).toEqual(before.price);
    });

    it("locks priced content after a successful update and submit", () => {
      const order = hydrate();

      expect(isSuccess(order.setPricedContent([line("a", 1, record(2000n))], []))).toBe(true);
      expect(isSuccess(order.submit())).toBe(true);

      const result = order.setPricedContent([line("b", 1, record(3000n))], []);

      expect(isFailure(result) && result.error.code).toBe("order:commitment_immutable");
    });

    it("submits a coherent draft without changing the stored record", () => {
      const order = hydrate();
      const stored = order.price;

      expect(isSuccess(order.submit())).toBe(true);
      expect(order.status).toBe("pending");
      expect(order.price).toEqual(stored);
    });

    it("submits an empty draft with the canonical zero record", () => {
      const order = hydrate({ lines: [], price: record(0n) });

      expect(isSuccess(order.submit())).toBe(true);
      expect(order.status).toBe("pending");
    });

    it("rejects submission of an empty draft with a non-zero record", () => {
      const order = hydrate({ lines: [], price: record(1n) });

      const result = order.submit();

      expect(isFailure(result) && result.error.code).toBe("order:price_incoherent");
      expect(order.status).toBe("draft");
    });

    it("rejects submission when an empty record differs only in modifier provenance", () => {
      const stored = zeroWithProvenanceModifier();
      const order = hydrate({ lines: [], price: stored });
      const before = PriceRecord.toPlain(order.price);

      expect(stored.subtotal).toBe(0n);
      expect(stored.total).toBe(0n);

      const result = order.submit();

      expect(isFailure(result) && result.error.code).toBe("order:price_incoherent");
      expect(order.status).toBe("draft");
      expect(PriceRecord.toPlain(order.price)).toEqual(before);
    });

    it("rejects submission when the stored record is not commitment-equal to the derived one", () => {
      const baseline = hydrate();
      const cases: ReadonlyArray<PriceRecord> = [
        { ...baseline.price, total: baseline.price.total + 1n },
        { ...baseline.price, semanticsId: 999 },
        { ...baseline.price, subtotal: baseline.price.subtotal + 1n },
      ];

      for (const stored of cases) {
        const order = hydrate({ price: stored });
        const result = order.submit();

        expect(isFailure(result) && result.error.code).toBe("order:price_incoherent");
        expect(order.status).toBe("draft");
        expect(order.price).toEqual(stored);
      }
    });

    it("rejects submission when stored modifiers are in an order that does not reproduce the total", () => {
      const fee = percentAdjustment("fee", 10n);
      const coupon = moneyAdjustment("coupon", 500n, "subtract");
      const lines = [line("a", 1, record(2400n))];
      const consistent = derive(lines, [fee, coupon]);
      const mismatched: PriceRecord = { ...consistent, total: 2090n };
      const order = hydrate({ lines, price: mismatched });

      expect(consistent.total).toBe(2140n);
      const result = order.submit();

      expect(isFailure(result) && result.error.code).toBe("order:price_incoherent");
      expect(order.status).toBe("draft");
    });

    it("maps stored currency disagreements to currency_mismatch", () => {
      const recordCurrency = record(1000n, [], usd);
      const order = hydrate({
        lines: [line("a", 1, recordCurrency)],
        price: record(1000n, [], usd),
        currency: priceCurrency(),
      });

      const result = order.submit();

      expect(isFailure(result) && result.error.code).toBe("order:currency_mismatch");
      expect(order.status).toBe("draft");
    });

    it("rejects illegal transitions from non-draft statuses", () => {
      const order = hydrate({ status: "pending" });

      const result = order.submit();

      expect(isFailure(result) && result.error.code).toBe("order:invalid_status_transition");
    });

    it("updates metadata in any status without touching priced content", () => {
      const order = hydrate();
      const stored = order.price;

      expect(isSuccess(order.update({ meta: { note: "draft" } }))).toBe(true);
      expect(isSuccess(order.submit())).toBe(true);
      expect(isSuccess(order.update({ meta: { note: "pending" } }))).toBe(true);

      expect(order.meta).toEqual({ note: "pending" });
      expect(order.price).toEqual(stored);
      expect(order.currency).toEqual(priceCurrency());
    });

    it("never increments the advisory version", () => {
      const order = hydrate();

      order.setPricedContent([line("a", 1, record(2000n))], []);
      order.submit();
      order.update({ meta: { note: "x" } });

      expect(order.version).toBe(0);
    });
  });

  describe("attachPayment (O-9)", () => {
    it("appends an initial fact and allows authorized → captured", () => {
      const order = createOrder();

      expect(isSuccess(order.attachPayment(receipt("pay-1", "authorized")))).toBe(true);
      expect(isSuccess(order.attachPayment(receipt("pay-1", "captured")))).toBe(true);
      expect(order.payments?.map((fact) => fact.status)).toEqual(["authorized", "captured"]);
    });

    it("treats an identical (paymentId, status) fact as a no-op", () => {
      const order = createOrder();
      order.attachPayment(receipt("pay-1", "captured"));
      const before = order.updatedAt.epochMilliseconds;

      expect(isSuccess(order.attachPayment(receipt("pay-1", "captured")))).toBe(true);
      expect(order.payments).toHaveLength(1);
      expect(order.updatedAt.epochMilliseconds).toBe(before);
    });

    it("conflicts on the same key with a different amount", () => {
      const order = createOrder();
      order.attachPayment(receipt("pay-1", "captured", 1000n));

      const result = order.attachPayment(receipt("pay-1", "captured", 2000n));

      expect(isFailure(result) && result.error.code).toBe("order:payment_fact_conflict");
    });

    it("conflicts on an illegal progression from a terminal fact", () => {
      const order = createOrder();
      order.attachPayment(receipt("pay-1", "captured"));

      const result = order.attachPayment(receipt("pay-1", "authorized"));

      expect(isFailure(result) && result.error.code).toBe("order:payment_fact_conflict");
    });

    it("always appends facts without a paymentId", () => {
      const order = createOrder();

      expect(isSuccess(order.attachPayment(receipt(undefined, "captured")))).toBe(true);
      expect(isSuccess(order.attachPayment(receipt(undefined, "captured")))).toBe(true);
      expect(order.payments).toHaveLength(2);
    });

    it("records a defensive copy of the supplied fact", () => {
      const order = createOrder();
      const fact = receipt("pay-1", "authorized");

      order.attachPayment(fact);
      fact.status = "captured";

      expect(order.payments?.[0]?.status).toBe("authorized");
    });
  });

  describe("changeShippingDestination", () => {
    const replacement = {
      addressId: "addr-2",
      lines: ["2 Main St"],
      city: "Milan",
      postalCode: "20100",
      countryCode: "IT",
      capturedAt: Instant.fromEpochMilliseconds(222222),
    };

    it("replaces the shipping destination while draft or pending", () => {
      for (const status of ["draft", "pending"] as const) {
        const order = hydrate({ status, addresses: [address] });

        expect(isSuccess(order.changeShippingDestination(replacement))).toBe(true);
        expect(order.addresses?.[0]?.addressId).toBe("addr-2");
      }
    });

    it("is a no-op for a structurally identical destination", () => {
      const order = hydrate({ addresses: [address] });
      const before = order.updatedAt.epochMilliseconds;

      expect(
        isSuccess(
          order.changeShippingDestination({
            addressId: address.addressId,
            lines: [...address.lines],
            city: address.city,
            administrativeArea: address.administrativeArea,
            postalCode: address.postalCode,
            countryCode: address.countryCode,
            capturedAt: address.capturedAt,
          })
        )
      ).toBe(true);
      expect(order.updatedAt.epochMilliseconds).toBe(before);
    });

    it("rejects a missing or ambiguous shipping destination", () => {
      const missing = hydrate({ addresses: [] });
      const ambiguous = hydrate({ addresses: [address, { ...address, addressId: "addr-2" }] });

      expect(isFailure(missing.changeShippingDestination(replacement)) && true).toBe(true);
      expect(isFailure(ambiguous.changeShippingDestination(replacement)) && true).toBe(true);
    });

    it("does not touch lines or price", () => {
      const order = hydrate({ addresses: [address] });
      const stored = { lines: order.lines, price: order.price };

      order.changeShippingDestination(replacement);

      expect(order.lines).toEqual(stored.lines);
      expect(order.price).toEqual(stored.price);
    });
  });

  describe("lifecycle transitions", () => {
    it("moves draft → pending → confirmed → fulfilled", () => {
      const order = createOrder();

      expect(isSuccess(order.submit())).toBe(true);
      expect(isSuccess(order.confirm())).toBe(true);
      expect(isSuccess(order.fulfill())).toBe(true);
      expect(order.status).toBe("fulfilled");
    });

    it("cancels from draft and is then terminal", () => {
      const order = createOrder();

      expect(isSuccess(order.cancel())).toBe(true);
      expect(isFailure(order.submit()) && true).toBe(true);
    });

    it("cancels from pending and confirmed", () => {
      const pending = createOrder();
      pending.submit();
      const confirmed = createOrder();
      confirmed.submit();
      confirmed.confirm();

      expect(isSuccess(pending.cancel())).toBe(true);
      expect(isSuccess(confirmed.cancel())).toBe(true);
    });
  });

  describe("withdrawn APIs", () => {
    it("does not expose the former line mutators", () => {
      const prototype = Order.prototype as unknown as Record<string, unknown>;

      expect(prototype["setLines"]).toBeUndefined();
      expect(prototype["addLine"]).toBeUndefined();
      expect(prototype["removeLine"]).toBeUndefined();
      expect(prototype["updateLineQuantity"]).toBeUndefined();
      expect(typeof prototype["setPricedContent"]).toBe("function");
    });
  });

  describe("snapshot", () => {
    it("includes currency, lines, price and historical facts", () => {
      const order = createOrder({
        customer,
        addresses: [address],
        payments: [receipt("p", "authorized")],
      });
      const snapshot = order.snapshot();

      expect(snapshot.id).toBe(order.id);
      expect(snapshot.currency).toEqual(priceCurrency());
      expect(snapshot.price).toEqual(order.price);
      expect(snapshot.lines).toEqual(order.lines);
      expect(snapshot.customer).toEqual(customer);
      expect(snapshot.addresses).toEqual([address]);
      expect(snapshot.payments).toHaveLength(1);
      expect(snapshot.capturedAt.epochMilliseconds).toBeGreaterThan(0);
    });

    it("is isolated from later aggregate mutations", () => {
      const order = createOrder();
      const snapshot = order.snapshot();

      order.setPricedContent([line("a", 1, record(2000n))], []);

      expect(snapshot.price).toEqual(record(1000n));
      expect(snapshot.lines[0]?.lineId).toBe("line-1");
    });
  });
});
