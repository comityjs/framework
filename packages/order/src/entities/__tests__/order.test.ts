import type { PriceCurrency, PriceModifier } from "@comity/pricing";
import type { OrderAddressSnapshot } from "../../contracts/address-snapshot.js";
import type { OrderCustomerSnapshot } from "../../contracts/customer-snapshot.js";
import type { OrderLine, OrderLineSubject } from "../../contracts/line.js";
import type { OrderCreate, OrderData } from "../../contracts/order.js";
import type { OrderPaymentSnapshot } from "../../contracts/payment-snapshot.js";
import type { OrderReversal } from "../../contracts/reversal.js";
import type { OrderStatus } from "../../contracts/order.js";

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

  describe("recordReversal (ADR-032 Amendment 4)", () => {
    const at = (ms: number): Instant => Instant.fromEpochMilliseconds(ms);

    function reversal(
      reversalId: string,
      amount: bigint,
      overrides: Partial<OrderReversal> = {}
    ): OrderReversal {
      return {
        reversalId,
        kind: "refund",
        amount: money(amount),
        paymentId: "pay-1",
        recordedAt: at(5000),
        ...overrides,
      };
    }

    function capturedOrder(total = 10000n, overrides: Partial<OrderCreate> = {}): Order {
      return hydrate({
        updatedAt: at(1000),
        payments: [receipt("pay-1", "authorized", total), receipt("pay-1", "captured", total)],
        ...overrides,
      });
    }

    function reason(result: ReturnType<Order["recordReversal"]>): string | undefined {
      return isFailure(result) ? result.error.meta.reason : undefined;
    }

    function details(result: ReturnType<Order["recordReversal"]>): unknown {
      return isFailure(result) ? result.error.meta.details : undefined;
    }

    describe("recording", () => {
      it("appends a refund reversal and preserves it exactly", () => {
        const order = capturedOrder();
        const fact = reversal(" r-1 ", 2500n);

        expect(isSuccess(order.recordReversal(fact))).toBe(true);
        expect(order.reversals).toEqual([fact]);
        expect(order.reversals[0]?.reversalId).toBe(" r-1 ");
      });

      it.each(["draft", "pending", "confirmed", "fulfilled", "cancelled"] as OrderStatus[])(
        "records in %s status without changing it",
        (status) => {
          const order = capturedOrder(10000n, { status });

          expect(isSuccess(order.recordReversal(reversal("r-1", 100n)))).toBe(true);
          expect(order.status).toBe(status);
          expect(order.reversals).toHaveLength(1);
        }
      );

      it("sets updatedAt to recordedAt, even when that moves it backwards", () => {
        const order = capturedOrder();

        order.recordReversal(reversal("r-1", 100n, { recordedAt: at(9000) }));
        expect(order.updatedAt.epochMilliseconds).toBe(9000);

        order.recordReversal(reversal("r-2", 100n, { recordedAt: at(2000) }));
        expect(order.updatedAt.epochMilliseconds).toBe(2000);
      });

      it("preserves unrelated order data and the version", () => {
        const order = capturedOrder();
        const before = order.snapshot();

        order.recordReversal(reversal("r-1", 100n));

        const after = order.snapshot();
        expect(after.lines).toEqual(before.lines);
        expect(after.price).toEqual(before.price);
        expect(after.payments).toEqual(before.payments);
        expect(after.status).toBe(before.status);
        expect(after.version).toBe(before.version);
      });

      it("does not deduplicate different reversal ids", () => {
        const order = capturedOrder();

        order.recordReversal(reversal("r-1", 100n));
        order.recordReversal(reversal("r-2", 100n));

        expect(order.reversals.map((fact) => fact.reversalId)).toEqual(["r-1", "r-2"]);
      });
    });

    describe("reversalId validation (P-3)", () => {
      it.each(["", "   ", "\t\n"])("rejects %j", (reversalId) => {
        const order = capturedOrder();
        const result = order.recordReversal(reversal(reversalId, 100n));

        expect(reason(result)).toBe("invalid_reversal_id");
        expect(details(result)).toEqual({ orderId: "order-1", field: "reversalId" });
        expect(order.reversals).toEqual([]);
      });

      it("validates before identity lookup", () => {
        const historical = reversal("", 100n);
        const order = capturedOrder(10000n, { reversals: [historical] });

        expect(reason(order.recordReversal(historical))).toBe("invalid_reversal_id");
        expect(order.reversals).toEqual([historical]);
      });

      it("does not retroactively reject hydrated historical reversals", () => {
        const historical = reversal("  ", 100n);
        const order = capturedOrder(10000n, { reversals: [historical] });

        expect(order.reversals).toEqual([historical]);
        expect(isSuccess(order.recordReversal(reversal("r-2", 100n)))).toBe(true);
      });

      it("adds no empty-string rule for paymentId", () => {
        const order = hydrate({
          payments: [receipt("", "captured", 500n)],
        });

        expect(isSuccess(order.recordReversal(reversal("r-1", 100n, { paymentId: "" })))).toBe(
          true
        );
      });
    });

    describe("amount validation and R-1 (P-1, D4-2)", () => {
      it("rejects a zero amount", () => {
        const order = capturedOrder();
        const result = order.recordReversal(reversal("r-1", 0n));

        expect(reason(result)).toBe("invalid_reversal_amount");
        expect(details(result)).toEqual({ orderId: "order-1", field: "amount" });
      });

      it("cannot receive a negative amount: Money cannot represent one", () => {
        expect(isFailure(Money.create(-1n, eur))).toBe(true);
      });

      it("treats a payment without a captured fact as zero captured", () => {
        const none = hydrate();
        const authorizedOnly = hydrate({ payments: [receipt("pay-1", "authorized")] });

        expect(reason(none.recordReversal(reversal("r-1", 1n)))).toBe("reversal_exceeds_captured");
        expect(reason(authorizedOnly.recordReversal(reversal("r-1", 1n)))).toBe(
          "reversal_exceeds_captured"
        );
      });

      it("allows up to the captured amount and rejects beyond it", () => {
        const order = capturedOrder(1000n);

        expect(isSuccess(order.recordReversal(reversal("r-1", 1000n)))).toBe(true);
        expect(reason(order.recordReversal(reversal("r-2", 1n)))).toBe("reversal_exceeds_captured");
        expect(order.reversals).toHaveLength(1);
      });

      it("rejects a single reversal above the captured amount with details", () => {
        const order = capturedOrder(1000n);
        const result = order.recordReversal(reversal("r-1", 1001n));

        expect(reason(result)).toBe("reversal_exceeds_captured");
        expect(details(result)).toEqual({ orderId: "order-1", field: "amount" });
      });

      it("accumulates multiple reversals", () => {
        const order = capturedOrder(1000n);

        expect(isSuccess(order.recordReversal(reversal("r-1", 400n)))).toBe(true);
        expect(isSuccess(order.recordReversal(reversal("r-2", 400n)))).toBe(true);
        expect(reason(order.recordReversal(reversal("r-3", 201n)))).toBe(
          "reversal_exceeds_captured"
        );
        expect(isSuccess(order.recordReversal(reversal("r-3", 200n)))).toBe(true);
      });

      it("accounts for different payments independently", () => {
        const order = hydrate({
          payments: [receipt("pay-1", "captured", 1000n), receipt("pay-2", "captured", 500n)],
        });

        expect(isSuccess(order.recordReversal(reversal("r-1", 1000n)))).toBe(true);
        expect(isSuccess(order.recordReversal(reversal("r-2", 500n, { paymentId: "pay-2" })))).toBe(
          true
        );
        expect(reason(order.recordReversal(reversal("r-3", 1n, { paymentId: "pay-2" })))).toBe(
          "reversal_exceeds_captured"
        );
      });

      it("accounts for different currencies independently, without conversion", () => {
        const order = capturedOrder(1000n);
        const usdReversal = reversal("r-1", 1n, { amount: money(1n, usd) });

        expect(reason(order.recordReversal(usdReversal))).toBe("reversal_exceeds_captured");
      });

      it("compares currency by the Money currency, which carries its code and derived exponent", () => {
        const jpy = unwrap(Currency.create("JPY"));
        const kwd = unwrap(Currency.create("KWD"));
        const order = hydrate({
          payments: [
            { paymentId: "pay-1", amount: money(100n, jpy), status: "captured" },
            { paymentId: "pay-2", amount: money(100n, kwd), status: "captured" },
          ],
        });

        expect(
          isSuccess(order.recordReversal(reversal("r-1", 100n, { amount: money(100n, jpy) })))
        ).toBe(true);
        expect(
          reason(
            order.recordReversal(
              reversal("r-2", 1n, { paymentId: "pay-2", amount: money(1n, jpy) })
            )
          )
        ).toBe("reversal_exceeds_captured");
      });

      it("keeps the one-captured-fact-per-paymentId contract of attachPayment", () => {
        const order = createOrder();

        order.attachPayment(receipt("pay-1", "captured", 1000n));

        expect(reason(order.attachPayment(receipt("pay-1", "captured", 2000n)))).toBe(
          "payment_fact_conflict"
        );
        expect(reason(order.recordReversal(reversal("r-1", 1001n)))).toBe(
          "reversal_exceeds_captured"
        );
      });
    });

    describe("idempotency and conflict (D4-3)", () => {
      it("treats an identical repeat as a no-op that leaves the aggregate untouched", () => {
        const order = capturedOrder();

        order.recordReversal(reversal("r-1", 100n, { recordedAt: at(5000) }));
        const updatedAt = order.updatedAt.epochMilliseconds;

        expect(
          isSuccess(order.recordReversal(reversal("r-1", 100n, { recordedAt: at(7000) })))
        ).toBe(true);
        expect(order.reversals).toHaveLength(1);
        expect(order.reversals[0]?.recordedAt.epochMilliseconds).toBe(5000);
        expect(order.updatedAt.epochMilliseconds).toBe(updatedAt);
      });

      it("neither reads nor validates recordedAt on a no-op", () => {
        const order = capturedOrder();

        order.recordReversal(reversal("r-1", 100n));

        for (const unusable of [NaN, Infinity, -Infinity, 8.64e15 + 1]) {
          const repeat = reversal("r-1", 100n, { recordedAt: at(unusable) });

          expect(isSuccess(order.recordReversal(repeat))).toBe(true);
        }
        expect(order.updatedAt.epochMilliseconds).toBe(5000);
      });

      it("reports a conflict for the same id with different amount, paymentId or kind", () => {
        const order = hydrate({
          payments: [receipt("pay-1", "captured", 1000n), receipt("pay-2", "captured", 1000n)],
        });

        order.recordReversal(reversal("r-1", 100n));

        const different = [
          reversal("r-1", 101n),
          reversal("r-1", 100n, { paymentId: "pay-2" }),
          reversal("r-1", 100n, { kind: "credit" as unknown as "refund" }),
        ];

        for (const candidate of different) {
          const result = order.recordReversal(candidate);

          expect(reason(result)).toBe("reversal_conflict");
          expect(details(result)).toEqual({ orderId: "order-1", field: "reversals" });
        }
        expect(order.reversals).toHaveLength(1);
      });

      it("retries a recorded reversal as a no-op even when R-1 would now reject it", () => {
        const order = capturedOrder(1000n);

        order.recordReversal(reversal("r-1", 1000n));

        expect(isSuccess(order.recordReversal(reversal("r-1", 1000n)))).toBe(true);
      });
    });

    describe("recordedAt validation (P-4)", () => {
      it.each([NaN, Infinity, -Infinity, 8.64e15 + 1, -8.64e15 - 1])(
        "rejects %s on append",
        (ms) => {
          const order = capturedOrder();
          const result = order.recordReversal(reversal("r-1", 100n, { recordedAt: at(ms) }));

          expect(reason(result)).toBe("invalid_reversal_timestamp");
          expect(details(result)).toEqual({ orderId: "order-1", field: "recordedAt" });
          expect(order.reversals).toEqual([]);
          expect(order.updatedAt.epochMilliseconds).toBe(1000);
        }
      );

      it("accepts both Date-range boundaries and fractional milliseconds", () => {
        const order = capturedOrder();

        for (const [index, ms] of [8.64e15, -8.64e15, 1.5].entries()) {
          const result = order.recordReversal(reversal(`r-${index}`, 1n, { recordedAt: at(ms) }));

          expect(isSuccess(result)).toBe(true);
          expect(order.updatedAt.epochMilliseconds).toBe(ms);
        }
      });

      it("imposes no chronology against the capture", () => {
        const order = capturedOrder(10000n, {
          payments: [
            {
              paymentId: "pay-1",
              amount: money(1000n),
              status: "captured",
              capturedAt: at(900000),
            },
          ],
        });

        expect(isSuccess(order.recordReversal(reversal("r-1", 1n, { recordedAt: at(1) })))).toBe(
          true
        );
      });
    });

    describe("immutability and failure atomicity", () => {
      it("leaves the aggregate unchanged on every rejection", () => {
        const order = capturedOrder(1000n);
        order.recordReversal(reversal("r-1", 100n));
        const before = { ...order.snapshot(), capturedAt: undefined };

        order.recordReversal(reversal("", 1n));
        order.recordReversal(reversal("r-1", 999n));
        order.recordReversal(reversal("r-2", 0n));
        order.recordReversal(reversal("r-2", 1n, { recordedAt: at(NaN) }));
        order.recordReversal(reversal("r-2", 5000n));

        expect({ ...order.snapshot(), capturedAt: undefined }).toEqual(before);
      });

      it("does not expose internal state through its accessors", () => {
        const order = capturedOrder();
        order.recordReversal(reversal("r-1", 100n));

        (order.reversals as OrderReversal[]).pop();
        (order.reversals[0] as { reversalId: string }).reversalId = "mutated";

        expect(order.reversals.map((fact) => fact.reversalId)).toEqual(["r-1"]);
      });
    });

    describe("hydration, creation and snapshots (D4-5)", () => {
      it("treats absent and empty reversals alike and omits them from the snapshot", () => {
        const absent = hydrate();
        const empty = hydrate({ reversals: [] });

        expect(absent.reversals).toEqual([]);
        expect(empty.reversals).toEqual([]);
        expect("reversals" in absent.snapshot()).toBe(false);
        expect("reversals" in empty.snapshot()).toBe(false);
      });

      it("round-trips reversals through snapshot and hydration verbatim", () => {
        const order = capturedOrder();
        order.recordReversal(reversal("r-1", 100n, { recordedAt: at(7000) }));

        const { capturedAt: _captured, ...state } = order.snapshot();
        const restored = new Order(state, state.id);

        expect(restored.reversals).toEqual(order.reversals);
        expect(restored.updatedAt.epochMilliseconds).toBe(7000);
      });

      it("applies the reversal rules to facts supplied to Order.create", () => {
        const payments = [receipt("pay-1", "captured", 1000n)];

        const created = unwrap(
          Order.create(data({ payments, reversals: [reversal("r-1", 1000n)] }), id)
        );
        expect(created.reversals).toHaveLength(1);

        const exceeding = Order.create(data({ payments, reversals: [reversal("r-1", 1001n)] }), id);
        expect(isFailure(exceeding) && exceeding.error.meta.reason).toBe(
          "reversal_exceeds_captured"
        );

        const empty = Order.create(data({ payments, reversals: [reversal(" ", 1n)] }), id);
        expect(isFailure(empty) && empty.error.meta.reason).toBe("invalid_reversal_id");
      });
    });

    describe("initial reversals in Order.create (Decision 1)", () => {
      const payments = [receipt("pay-1", "captured", 1000n)];
      const create = (reversals: OrderReversal[]) =>
        Order.create(data({ payments, reversals }), id);

      it("accepts valid unique initial reversals and preserves their order", () => {
        const created = unwrap(
          create([reversal("r-2", 100n), reversal("r-1", 200n), reversal("r-3", 300n)])
        );

        expect(created.reversals.map((fact) => fact.reversalId)).toEqual(["r-2", "r-1", "r-3"]);
      });

      it.each([
        ["identical", reversal("r-1", 100n)],
        ["different", reversal("r-1", 200n)],
      ])("rejects a %s duplicate reversalId instead of deduplicating", (_label, second) => {
        const result = create([reversal("r-1", 100n), second]);

        expect(isFailure(result) && result.error.meta.reason).toBe("reversal_conflict");
        expect(isFailure(result) && result.error.meta.details).toEqual({
          orderId: "order-1",
          field: "reversals",
        });
      });

      it("still validates an empty id before reporting a duplicate", () => {
        const result = create([reversal("", 100n), reversal("", 100n)]);

        expect(isFailure(result) && result.error.meta.reason).toBe("invalid_reversal_id");
      });

      it("rejects a zero amount in initial reversals", () => {
        const result = create([reversal("r-1", 0n)]);

        expect(isFailure(result) && result.error.meta.reason).toBe("invalid_reversal_amount");
        expect(isFailure(result) && result.error.meta.details).toEqual({
          orderId: "order-1",
          field: "amount",
        });
      });

      it.each([NaN, Infinity, 8.64e15 + 1])(
        "rejects an invalid timestamp (%s) in initial reversals",
        (ms) => {
          const result = create([reversal("r-1", 100n, { recordedAt: at(ms) })]);

          expect(isFailure(result) && result.error.meta.reason).toBe("invalid_reversal_timestamp");
          expect(isFailure(result) && result.error.meta.details).toEqual({
            orderId: "order-1",
            field: "recordedAt",
          });
        }
      );

      it("rejects an invalid runtime kind in initial reversals", () => {
        const result = create([reversal("r-1", 100n, { kind: "credit" as unknown as "refund" })]);

        expect(isFailure(result) && result.error.meta.reason).toBe("invalid_reversal_kind");
      });

      it("keeps hydration verbatim, historical duplicate ids included", () => {
        const duplicate = reversal("r-1", 100n);
        const order = hydrate({ payments, reversals: [duplicate, duplicate] });

        expect(order.reversals).toEqual([duplicate, duplicate]);
      });
    });

    describe("at most one captured fact per paymentId (Decision 2)", () => {
      it.each([
        ["identical", receipt("pay-1", "captured", 1000n)],
        ["different", receipt("pay-1", "captured", 2000n)],
      ])("Order.create rejects a second %s captured fact", (_label, second) => {
        const result = Order.create(
          data({ payments: [receipt("pay-1", "captured", 1000n), second] }),
          id
        );

        expect(isFailure(result) && result.error.meta.reason).toBe("payment_fact_conflict");
        expect(isFailure(result) && result.error.meta.details).toEqual({
          orderId: "order-1",
          field: "payments",
        });
      });

      it("Order.create still accepts captured facts for different payment ids", () => {
        const result = Order.create(
          data({
            payments: [
              receipt("pay-1", "authorized"),
              receipt("pay-1", "captured"),
              receipt("pay-2", "captured"),
            ],
          }),
          id
        );

        expect(isSuccess(result)).toBe(true);
      });

      it("recordReversal fails conservatively on hydrated duplicate captured facts", () => {
        for (const second of [
          receipt("pay-1", "captured", 1000n),
          receipt("pay-1", "captured", 5000n),
        ]) {
          const order = hydrate({
            updatedAt: at(1000),
            payments: [receipt("pay-1", "captured", 1000n), second],
          });
          const result = order.recordReversal(reversal("r-1", 1n));

          expect(reason(result)).toBe("reversal_conflict");
          expect(details(result)).toEqual({ orderId: "order-1", field: "reversals" });
          expect(order.reversals).toEqual([]);
          expect(order.updatedAt.epochMilliseconds).toBe(1000);
        }
      });

      it("recordReversal works normally with exactly one captured fact", () => {
        const order = capturedOrder(1000n);

        expect(isSuccess(order.recordReversal(reversal("r-1", 1000n)))).toBe(true);
      });

      it("runs the guard only for a new append, not for a no-op", () => {
        const order = hydrate({
          payments: [receipt("pay-1", "captured", 1000n), receipt("pay-1", "captured", 1000n)],
          reversals: [reversal("r-1", 100n)],
        });

        expect(isSuccess(order.recordReversal(reversal("r-1", 100n)))).toBe(true);
      });
    });

    describe("runtime reversal kind (Decision 3)", () => {
      const invalidKind = (reversalId = "r-1"): OrderReversal =>
        reversal(reversalId, 100n, { kind: "credit" as unknown as "refund" });

      it("accepts kind refund when every other rule passes", () => {
        expect(isSuccess(capturedOrder().recordReversal(reversal("r-1", 100n)))).toBe(true);
      });

      it("rejects an invalid kind on a new reversal without mutating state", () => {
        const order = capturedOrder();
        const result = order.recordReversal(invalidKind());

        expect(reason(result)).toBe("invalid_reversal_kind");
        expect(details(result)).toEqual({ orderId: "order-1", field: "kind" });
        expect(isFailure(result) && result.error.meta.httpStatus).toBe(400);
        expect(order.reversals).toEqual([]);
        expect(order.updatedAt.epochMilliseconds).toBe(1000);
      });

      it("keeps identity first: an existing id yields conflict, never invalid kind", () => {
        const order = capturedOrder();
        order.recordReversal(reversal("r-1", 100n));

        expect(reason(order.recordReversal(invalidKind("r-1")))).toBe("reversal_conflict");
      });

      it("does not validate the kind of hydrated reversals; an identical retry stays a no-op", () => {
        const historical = invalidKind("r-1");
        const order = capturedOrder(10000n, { reversals: [historical] });

        expect(order.reversals).toEqual([historical]);
        expect(isSuccess(order.recordReversal(historical))).toBe(true);
        expect(order.reversals).toHaveLength(1);
      });

      it("reports an invalid kind before the amount and timestamp checks", () => {
        const order = capturedOrder();
        const bad = reversal("r-1", 0n, {
          kind: "credit" as unknown as "refund",
          recordedAt: at(NaN),
        });

        expect(reason(order.recordReversal(bad))).toBe("invalid_reversal_kind");
      });
    });

    describe("validation precedence (Decision 4)", () => {
      it("reports an empty id before an invalid amount and timestamp", () => {
        const result = capturedOrder().recordReversal(reversal("", 0n, { recordedAt: at(NaN) }));

        expect(reason(result)).toBe("invalid_reversal_id");
      });

      it("reports a conflict before validating the retry's amount or timestamp", () => {
        const order = capturedOrder();
        order.recordReversal(reversal("r-1", 100n));

        expect(reason(order.recordReversal(reversal("r-1", 0n)))).toBe("reversal_conflict");
        expect(reason(order.recordReversal(reversal("r-1", 200n, { recordedAt: at(NaN) })))).toBe(
          "reversal_conflict"
        );
      });

      it("reports the amount before the timestamp, and the timestamp before R-1", () => {
        const order = capturedOrder(100n);

        expect(reason(order.recordReversal(reversal("r-1", 0n, { recordedAt: at(NaN) })))).toBe(
          "invalid_reversal_amount"
        );
        expect(reason(order.recordReversal(reversal("r-2", 5000n, { recordedAt: at(NaN) })))).toBe(
          "invalid_reversal_timestamp"
        );
      });

      it("evaluates R-1 only for a genuinely new append", () => {
        const order = capturedOrder(100n, { reversals: [reversal("r-1", 500n)] });

        expect(isSuccess(order.recordReversal(reversal("r-1", 500n)))).toBe(true);
        expect(reason(order.recordReversal(reversal("r-2", 1n)))).toBe("reversal_exceeds_captured");
      });

      it("an identical retry with an invalid timestamp stays a no-op", () => {
        const order = capturedOrder();
        order.recordReversal(reversal("r-1", 100n));

        expect(
          isSuccess(order.recordReversal(reversal("r-1", 100n, { recordedAt: at(Infinity) })))
        ).toBe(true);
        expect(order.reversals).toHaveLength(1);
      });

      it("leaves reversals and updatedAt unchanged on every rejection path", () => {
        const order = capturedOrder(1000n, {
          payments: [receipt("pay-1", "captured", 1000n), receipt("pay-1", "captured", 1000n)],
        });
        const before = {
          reversals: order.reversals,
          updatedAt: order.updatedAt.epochMilliseconds,
        };

        for (const candidate of [
          reversal("", 1n),
          reversal("r-1", 1n, { kind: "credit" as unknown as "refund" }),
          reversal("r-1", 0n),
          reversal("r-1", 1n, { recordedAt: at(NaN) }),
          reversal("r-1", 1n),
        ]) {
          expect(isFailure(order.recordReversal(candidate))).toBe(true);
        }
        expect(order.reversals).toEqual(before.reversals);
        expect(order.updatedAt.epochMilliseconds).toBe(before.updatedAt);
      });
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
