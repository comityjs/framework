import type { Price, PriceModifier } from "@comity/pricing";
import type { OrderAddressSnapshot } from "../../contracts/address-snapshot.js";
import type { OrderCustomerSnapshot } from "../../contracts/customer-snapshot.js";
import type { OrderPaymentSnapshot } from "../../contracts/payment-snapshot.js";
import type { OrderCreate } from "../../contracts/order.js";
import type { OrderItem, OrderProductSnapshot } from "../../contracts/item.js";

import { Currency, Money, Price } from "@comity/pricing";
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
const money = (amount: bigint): Money => unwrap(Money.create(amount, eur));
const price = (amount: bigint, modifiers: ReadonlyArray<PriceModifier> = []): Price =>
  unwrap(Price.create(money(amount), modifiers));
const amount = (value: Money): bigint => value.amount;
const modifier = (code: string, kind: PriceModifier["kind"], value: bigint): PriceModifier => ({
  code,
  kind,
  adjustment: { type: "money", amount: money(value), operation: "add" },
});

const id = unwrap(OrderId.create("order-1"));
const product: OrderProductSnapshot = { productId: "prod-1", sku: "SKU-1", name: "T-shirt" };
const item: OrderItem = {
  id: "item-1",
  product,
  quantity: 2,
  price: price(10000n),
};

const fields: OrderCreate = {
  items: [item],
  price: price(10000n),
  meta: { channel: "web" },
  createdAt: Instant.fromEpochMilliseconds(123456789),
};

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
const payment: OrderPaymentSnapshot = {
  paymentId: "pay-1",
  amount: money(10000n),
  status: "captured",
  provider: "acme",
  reference: "ref-1",
};

function createOrder(overrides?: Partial<OrderCreate>): Order {
  return new Order({ ...fields, ...overrides }, id);
}

describe("Order", () => {
  describe("creation", () => {
    it("should initialize all fields correctly", () => {
      const order = createOrder();

      expect(order.id.toString()).toBe("order-1");
      expect(order.status).toBe("draft");
      expect(order.items).toHaveLength(1);
      expect(amount(order.price.total)).toBe(10000n);
      expect(order.meta).toEqual({ channel: "web" });
      expect(order.createdAt).toBeInstanceOf(Instant);
    });

    it("should expose the caller-supplied id and never change it", () => {
      const order = createOrder();

      expect(order.id.toString()).toBe("order-1");
      expect(() => {
        (order as unknown as { id: OrderId }).id = unwrap(OrderId.create("order-2"));
      }).toThrow();
      expect(order.id.toString()).toBe("order-1");
    });

    it("should default status to draft on creation", () => {
      const order = createOrder();

      expect(order.status).toBe("draft");
    });

    it("should default updatedAt to createdAt", () => {
      const order = createOrder();

      expect(order.updatedAt).toBeInstanceOf(Instant);
    });

    it("should accept explicit updatedAt", () => {
      const updatedAt = Instant.fromEpochMilliseconds(987654321);
      const order = createOrder({ updatedAt });

      expect(order.updatedAt).toBe(updatedAt);
    });

    it("should restore persisted status and timestamps during hydration", () => {
      const createdAt = Instant.fromEpochMilliseconds(1000);
      const updatedAt = Instant.fromEpochMilliseconds(2000);
      const order = new Order(
        { ...fields, status: "confirmed", createdAt, updatedAt },
        id,
      );

      expect(order.status).toBe("confirmed");
      expect(order.createdAt).toBe(createdAt);
      expect(order.updatedAt).toBe(updatedAt);
    });

    it("should defensive-copy items on creation", () => {
      const items = [item];
      const order = new Order({ ...fields, items }, id);

      items.pop();

      expect(order.items).toHaveLength(1);
    });

    it("should defensively copy item data on creation", () => {
      const attributes = [{ code: "color", label: "Color", value: "red" }];
      const metadata = { image: "https://cdn.example.com/p-1.jpg" };
      const meta = { note: "original" };
      const source = {
        id: "src-1",
        product: { productId: "prod-9", sku: "SKU-9", name: "Jacket", attributes, metadata },
        quantity: 1,
        price: price(9000n),
        meta,
      };
      const order = new Order({ items: [source], price: price(9000n) }, id);

      source.quantity = 9;
      source.product.sku = "CHANGED";
      attributes[0] = { code: "color", value: "blue" };
      metadata.image = "changed.jpg";
      meta.note = "changed";

      const stored = order.items[0];
      expect(stored?.quantity).toBe(1);
      expect(stored?.product.sku).toBe("SKU-9");
      expect(stored?.product.attributes?.[0]?.value).toBe("red");
      expect(stored?.product.metadata?.image).toBe("https://cdn.example.com/p-1.jpg");
      expect(stored?.meta?.note).toBe("original");
    });

    it("should preserve supplied item IDs during hydration", () => {
      const persisted = { ...item, id: "persisted-9" };
      const order = new Order({ ...fields, items: [persisted] }, id);

      expect(order.items[0]?.id).toBe("persisted-9");
      expect(order.snapshot().items[0]?.id).toBe("persisted-9");
    });

    it("should default meta to undefined", () => {
      const order = new Order({ items: [], price: price(0n) }, id);

      expect(order.meta).toBeUndefined();

      const snapshot = order.snapshot();

      expect(snapshot.meta).toBeUndefined();
    });

    it("should expose applied modifiers through the price", () => {
      const order = new Order(
        {
          ...fields,
          price: price(10000n, [modifier("discount-10", "discount", 1000n)]),
        },
        id,
      );

      expect(order.price.modifiers).toHaveLength(1);
      expect(order.snapshot().price.modifiers).toHaveLength(1);
    });

    it("should validate mutations on an order with an id", () => {
      const order = new Order({ items: [], price: price(0n) }, id);

      expect(isFailure(order.addItem({ id: "item-x", product, quantity: 0, price: price(0n) }))).toBe(true);
      expect(isFailure(order.removeItem("missing"))).toBe(true);
      expect(isFailure(order.updateItemQuantity("missing", 1))).toBe(true);
    });
  });

  describe("items", () => {
    it("should return item copies that cannot mutate the aggregate", () => {
      const attributes = [{ code: "color", label: "Color", value: "red" }];
      const order = createOrder({
        items: [
          {
            ...item,
            product: { ...product, attributes, metadata: { image: "https://cdn.example.com/p-1.jpg" } },
            meta: { note: "original" },
          },
        ],
      });

      const returned = order.items[0]!;

      (returned as { quantity: number }).quantity = 99;
      (returned.meta as Record<string, unknown>).note = "changed";
      (returned.product as { sku: string }).sku = "CHANGED";
      (returned.product.attributes as Array<{ code: string; value: string | number | boolean }>).push({
        code: "size",
        value: "L",
      });

      const stored = order.items[0];
      expect(stored?.quantity).toBe(2);
      expect(stored?.meta?.note).toBe("original");
      expect(stored?.product.sku).toBe("SKU-1");
      expect(stored?.product.attributes).toHaveLength(1);
      expect(stored?.product.attributes?.[0]?.value).toBe("red");
    });
  });

  describe("update", () => {
    it("should update applied pricing and metadata", () => {
      const order = createOrder();

      order.update({
        price: price(9000n),
        meta: { channel: "mobile" },
      });

      expect(amount(order.price.total)).toBe(9000n);
      expect(order.meta).toEqual({ channel: "mobile" });
    });

    it("should update modifiers through the price", () => {
      const order = createOrder();

      order.update({ price: price(9000n, [modifier("tax", "tax", 500n)]) });

      expect(order.price.modifiers).toHaveLength(1);
      expect(order.price.modifiers[0]?.code).toBe("tax");
    });

    it("should not change fields that are not updated", () => {
      const order = createOrder();

      order.update({});

      expect(order.items).toHaveLength(1);
      expect(order.status).toBe("draft");
    });
  });

  describe("snapshot", () => {
    it("should capture current state", () => {
      const order = createOrder();
      const snapshot = order.snapshot();

      expect(snapshot.id.toString()).toBe("order-1");
      expect(snapshot.status).toBe("draft");
      expect(snapshot.items).toHaveLength(1);
      expect(amount(snapshot.price.total)).toBe(10000n);
      expect(snapshot.meta).toEqual({ channel: "web" });
      expect(snapshot.createdAt).toBeInstanceOf(Instant);
      expect(snapshot.updatedAt).toBeInstanceOf(Instant);
      expect(snapshot.capturedAt).toBeInstanceOf(Instant);
    });

    it("should be immutable after mutation of source", () => {
      const order = createOrder();
      const snapshot = order.snapshot();

      order.update({ meta: { channel: "mobile" } });

      expect(snapshot.meta).toEqual({ channel: "web" });
    });

    it("should isolate snapshot items from later aggregate mutations", () => {
      const order = createOrder();
      const snapshot = order.snapshot();

      order.updateItemQuantity("item-1", 7);

      expect(snapshot.items[0]?.quantity).toBe(2);

      (snapshot.items[0] as { quantity: number }).quantity = 99;
      expect(order.items[0]?.quantity).toBe(7);
    });
  });

  describe("addItem", () => {
    it("should add an item with the caller-supplied occurrence id", () => {
      const order = createOrder();
      const result = order.addItem({
        id: "item-2",
        product: { productId: "prod-2", sku: "SKU-2", name: "Socks" },
        quantity: 3,
        price: price(3000n),
      });

      expect(isSuccess(result)).toBe(true);
      expect(order.items).toHaveLength(2);
      if (isSuccess(result)) {
        expect(result.value.id).toBe("item-2");
        expect(result.value.product.productId).toBe("prod-2");
        expect(result.value.quantity).toBe(3);
        expect(order.items.map((entry) => entry.id)).toEqual(["item-1", "item-2"]);
      }
    });

    it("should allow identical product data under distinct occurrence ids", () => {
      const order = createOrder();
      const first = order.addItem({ id: "occ-1", product, quantity: 1, price: price(10000n) });
      const second = order.addItem({ id: "occ-2", product, quantity: 1, price: price(10000n) });

      expect(isSuccess(first)).toBe(true);
      expect(isSuccess(second)).toBe(true);
      expect(order.items).toHaveLength(3);
      expect(order.items.map((entry) => entry.id)).toEqual(["item-1", "occ-1", "occ-2"]);
    });

    it("should reject a duplicate occurrence id with duplicate_item_id", () => {
      const order = createOrder();
      const before = order.snapshot();
      const result = order.addItem({ id: "item-1", product, quantity: 1, price: price(1000n) });

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:duplicate_item_id");
        expect(result.error.meta.details).toEqual({
          orderId: "order-1",
          itemId: "item-1",
        });
      }
      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.quantity).toBe(2);
      expect(order.updatedAt.epochMilliseconds).toBe(before.updatedAt.epochMilliseconds);
    });

    it("should check quantity before id uniqueness", () => {
      const order = createOrder();
      const result = order.addItem({ id: "item-1", product, quantity: 0, price: price(1000n) });

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_quantity");
        expect(result.error.meta.details).toEqual({
          orderId: "order-1",
          itemId: "item-1",
          field: "quantity",
        });
      }
      expect(order.items).toHaveLength(1);
    });

    it("should never reuse a removed occurrence id on its own", () => {
      const order = createOrder();
      expect(isSuccess(order.addItem({ id: "occ-1", product, quantity: 1, price: price(1000n) }))).toBe(true);
      expect(isSuccess(order.removeItem("occ-1"))).toBe(true);
      expect(isSuccess(order.addItem({ id: "occ-2", product, quantity: 1, price: price(1000n) }))).toBe(true);

      expect(order.items.map((entry) => entry.id)).toEqual(["item-1", "occ-2"]);
    });

    it("should accept an explicitly re-supplied removed id without touching retained occurrences", () => {
      const order = createOrder();
      expect(isSuccess(order.addItem({ id: "occ-1", product, quantity: 1, price: price(1000n) }))).toBe(true);
      expect(isSuccess(order.removeItem("occ-1"))).toBe(true);
      const result = order.addItem({ id: "occ-1", product, quantity: 4, price: price(4000n) });

      expect(isSuccess(result)).toBe(true);
      expect(order.items.map((entry) => entry.id)).toEqual(["item-1", "occ-1"]);
      expect(order.items.find((entry) => entry.id === "item-1")?.quantity).toBe(2);
      expect(order.items.find((entry) => entry.id === "occ-1")?.quantity).toBe(4);
    });

    it("should defensively copy the product snapshot", () => {
      const order = createOrder();
      const attributes = [{ code: "color", label: "Color", value: "red" }];
      const options = [{ code: "size", label: "Size", value: "M" }];
      const metadata = { image: "https://cdn.example.com/p-1.jpg" };

      const result = order.addItem({
        id: "item-3",
        product: {
          productId: "prod-3",
          sku: "SKU-3",
          name: "Hoodie",
          attributes,
          options,
          metadata,
          variant: { id: "v-1", sku: "SKU-3-M", name: "Hoodie M", options },
        },
        quantity: 1,
        price: price(5000n),
      });

      attributes[0] = { code: "color", value: "blue" };
      options[0] = { code: "size", value: "L" };
      metadata.image = "https://cdn.example.com/changed.jpg";

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const stored = result.value.product;
        expect(stored.attributes?.[0]?.value).toBe("red");
        expect(stored.options?.[0]?.value).toBe("M");
        expect(stored.metadata).toEqual({ image: "https://cdn.example.com/p-1.jpg" });
        expect(stored.variant?.options?.[0]?.value).toBe("M");
      }
    });

    it("should reject a zero quantity with invalid_quantity", () => {
      const order = createOrder();
      const result = order.addItem({
        id: "item-9",
        product,
        quantity: 0,
        price: price(5000n),
      });

      expect(isFailure(result)).toBe(true);
      expect(order.items).toHaveLength(1);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_quantity");
      }
    });

    it("should reject a non-integer quantity with invalid_quantity", () => {
      const order = createOrder();
      const result = order.addItem({
        id: "item-9",
        product,
        quantity: 1.5,
        price: price(5000n),
      });

      expect(isFailure(result)).toBe(true);
    });

    it("should return an item copy isolated from the aggregate", () => {
      const order = createOrder();
      const result = order.addItem({ id: "item-4", product, quantity: 3, price: price(3000n) });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        (result.value as { quantity: number }).quantity = 99;
        (result.value.product as { name: string }).name = "Changed";

        const stored = order.items.find((entry) => entry.id === result.value.id);
        expect(stored?.quantity).toBe(3);
        expect(stored?.product.name).toBe("T-shirt");
      }
    });
  });

  describe("removeItem", () => {
    it("should remove an existing item", () => {
      const order = createOrder();
      const result = order.removeItem("item-1");

      expect(isSuccess(result)).toBe(true);
      expect(order.items).toHaveLength(0);
    });

    it("should reject removal of an unknown item with invalid_item", () => {
      const order = createOrder();
      const result = order.removeItem("missing");

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_item");
      }
    });
  });

  describe("updateItemQuantity", () => {
    it("should update the quantity of an existing item", () => {
      const order = createOrder();
      const result = order.updateItemQuantity("item-1", 5);

      expect(isSuccess(result)).toBe(true);
      expect(order.items[0]?.quantity).toBe(5);
    });

    it("should reject a zero quantity with invalid_quantity", () => {
      const order = createOrder();
      const result = order.updateItemQuantity("item-1", 0);

      expect(isFailure(result)).toBe(true);
    });

    it("should reject an unknown item with invalid_item", () => {
      const order = createOrder();
      const result = order.updateItemQuantity("missing", 1);

      expect(isFailure(result)).toBe(true);
    });
  });

  describe("setItems", () => {
    const otherItem: OrderItem = {
      id: "item-2",
      product: { productId: "prod-2", sku: "SKU-2", name: "Socks" },
      quantity: 3,
      price: price(3000n),
    };

    it("should replace the entire collection and preserve the supplied order", () => {
      const order = createOrder();
      const result = order.setItems([otherItem, item]);

      expect(isSuccess(result)).toBe(true);
      expect(order.items.map((entry) => entry.id)).toEqual(["item-2", "item-1"]);
    });

    it("should remove items omitted from the supplied collection", () => {
      const order = createOrder();
      const result = order.setItems([otherItem]);

      expect(isSuccess(result)).toBe(true);
      expect(order.items.map((entry) => entry.id)).toEqual(["item-2"]);
    });

    it("should succeed with an empty collection", () => {
      const order = createOrder({ updatedAt: Instant.fromEpochMilliseconds(2000) });
      const result = order.setItems([]);

      expect(isSuccess(result)).toBe(true);
      expect(order.items).toHaveLength(0);
      expect(order.updatedAt.epochMilliseconds).toBeGreaterThan(2000);
    });

    it("should refresh updatedAt when the replacement is identical", () => {
      const order = createOrder({ updatedAt: Instant.fromEpochMilliseconds(2000) });
      const result = order.setItems([item]);

      expect(isSuccess(result)).toBe(true);
      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.id).toBe("item-1");
      expect(order.updatedAt.epochMilliseconds).toBeGreaterThan(2000);
    });

    it("should reject a zero quantity with invalid_quantity", () => {
      const order = createOrder();
      const result = order.setItems([
        { id: "ok-1", product, quantity: 1, price: price(100n) },
        { id: "bad-1", product, quantity: 0, price: price(200n) },
      ]);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_quantity");
        expect(result.error.meta.details).toEqual({
          orderId: "order-1",
          itemId: "bad-1",
          field: "quantity",
        });
      }
    });

    it("should reject a non-integer quantity with invalid_quantity", () => {
      const order = createOrder();
      const result = order.setItems([
        { id: "bad-2", product, quantity: 1.5, price: price(100n) },
      ]);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_quantity");
      }
    });

    it("should reject duplicate item IDs with duplicate_item_id", () => {
      const order = createOrder();
      const result = order.setItems([
        { id: "dup", product, quantity: 1, price: price(100n) },
        { id: "dup", product, quantity: 2, price: price(200n) },
      ]);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:duplicate_item_id");
        expect(result.error.message).toBe("Duplicate order item identifier");
        expect(result.error.meta.httpStatus).toBe(400);
        expect(result.error.meta.details).toEqual({ orderId: "order-1", itemId: "dup" });
      }
      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.id).toBe("item-1");
    });

    it("should check quantity before ID uniqueness within an entry", () => {
      const order = createOrder();
      const result = order.setItems([
        { id: "shared", product, quantity: 1, price: price(100n) },
        { id: "shared", product, quantity: 0, price: price(200n) },
      ]);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_quantity");
        expect(result.error.meta.details?.itemId).toBe("shared");
      }
    });

    it("should report an earlier duplicate before a later quantity violation", () => {
      const order = createOrder();
      const result = order.setItems([
        { id: "k1", product, quantity: 1, price: price(100n) },
        { id: "k1", product, quantity: 1, price: price(200n) },
        { id: "k3", product, quantity: 0, price: price(300n) },
      ]);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:duplicate_item_id");
        expect(result.error.meta.details?.itemId).toBe("k1");
      }
    });

    it("should report an earlier quantity violation before a later duplicate", () => {
      const order = createOrder();
      const result = order.setItems([
        { id: "z1", product, quantity: 0, price: price(100n) },
        { id: "z1", product, quantity: 1, price: price(200n) },
      ]);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_quantity");
        expect(result.error.meta.details?.itemId).toBe("z1");
      }
    });

    it("should leave all state unchanged when replacement fails", () => {
      const order = createOrder({ updatedAt: Instant.fromEpochMilliseconds(2000) });
      const before = order.snapshot();

      const result = order.setItems([
        { id: "ok-1", product, quantity: 1, price: price(100n) },
        { id: "ok-2", product, quantity: 0, price: price(200n) },
      ]);

      expect(isFailure(result)).toBe(true);
      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.id).toBe("item-1");
      expect(order.items[0]?.quantity).toBe(2);
      expect(amount(order.price.total)).toBe(10000n);
      expect(order.status).toBe("draft");
      expect(order.meta).toEqual({ channel: "web" });
      expect(order.updatedAt.epochMilliseconds).toBe(2000);
      expect(before.items).toHaveLength(1);
      expect(before.updatedAt.epochMilliseconds).toBe(2000);
    });

    it("should accept identical content under distinct IDs", () => {
      const order = createOrder();
      const result = order.setItems([
        { id: "occ-1", product, quantity: 1, price: price(10000n) },
        { id: "occ-2", product, quantity: 1, price: price(10000n) },
      ]);

      expect(isSuccess(result)).toBe(true);
      expect(order.items).toHaveLength(2);
      expect(order.items.map((entry) => entry.id)).toEqual(["occ-1", "occ-2"]);
    });

    it("should address only the targeted occurrence when contents are identical", () => {
      const order = createOrder();
      order.setItems([
        { id: "occ-1", product, quantity: 1, price: price(10000n) },
        { id: "occ-2", product, quantity: 1, price: price(10000n) },
      ]);

      expect(isSuccess(order.updateItemQuantity("occ-2", 5))).toBe(true);
      expect(order.items.find((entry) => entry.id === "occ-1")?.quantity).toBe(1);
      expect(order.items.find((entry) => entry.id === "occ-2")?.quantity).toBe(5);

      expect(isSuccess(order.removeItem("occ-1"))).toBe(true);
      expect(order.items.map((entry) => entry.id)).toEqual(["occ-2"]);
    });

    it("should defensively copy caller-owned input", () => {
      const order = createOrder();
      const attributes = [{ code: "color", label: "Color", value: "red" }];
      const metadata = { image: "https://cdn.example.com/p-1.jpg" };
      const meta = { note: "original" };
      const linePrice = price(9000n);
      const supplied = [
        {
          id: "src-1",
          product: {
            productId: "prod-9",
            sku: "SKU-9",
            name: "Jacket",
            attributes,
            metadata,
            variant: { id: "v-9", sku: "SKU-9-M", name: "Jacket M" },
          },
          quantity: 1,
          price: linePrice,
          meta,
        },
      ];

      const result = order.setItems(supplied);

      expect(isSuccess(result)).toBe(true);

      supplied.pop();
      attributes[0] = { code: "color", value: "blue" };
      metadata.image = "changed.jpg";
      meta.note = "changed";

      const stored = order.items[0];
      expect(order.items).toHaveLength(1);
      expect(stored?.id).toBe("src-1");
      expect(stored?.product.sku).toBe("SKU-9");
      expect(stored?.product.attributes?.[0]?.value).toBe("red");
      expect(stored?.product.metadata?.image).toBe("https://cdn.example.com/p-1.jpg");
      expect(stored?.meta?.note).toBe("original");
      expect(stored?.price).toBe(linePrice);
    });

    it("should copy item meta shallowly", () => {
      const order = createOrder();
      const nested = { count: 1 };
      const meta = { note: "original", nested };
      const result = order.setItems([
        { id: "src-2", product, quantity: 1, price: price(100n), meta },
      ]);

      expect(isSuccess(result)).toBe(true);

      meta.note = "changed";

      const stored = order.items[0]?.meta;
      expect(stored?.note).toBe("original");
      expect(stored?.nested).toBe(nested);
    });

    it("should apply regardless of lifecycle status", () => {
      const order = createOrder();
      order.submit();
      order.confirm();

      const result = order.setItems([otherItem]);

      expect(isSuccess(result)).toBe(true);
      expect(order.status).toBe("confirmed");
      expect(order.items.map((entry) => entry.id)).toEqual(["item-2"]);
    });
  });

  describe("lifecycle transitions", () => {
    it("should submit a draft order to pending", () => {
      const order = createOrder();
      const result = order.submit();

      expect(isSuccess(result)).toBe(true);
      expect(order.status).toBe("pending");
    });

    it("should confirm a pending order to confirmed", () => {
      const order = createOrder();
      order.submit();
      const result = order.confirm();

      expect(isSuccess(result)).toBe(true);
      expect(order.status).toBe("confirmed");
    });

    it("should fulfill a confirmed order to fulfilled", () => {
      const order = createOrder();
      order.submit();
      order.confirm();
      const result = order.fulfill();

      expect(isSuccess(result)).toBe(true);
      expect(order.status).toBe("fulfilled");
    });

    it("should reject invalid transitions with invalid_status_transition", () => {
      const order = createOrder();
      const result = order.confirm();

      expect(isFailure(result)).toBe(true);
      expect(order.status).toBe("draft");
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:invalid_status_transition");
      }
    });

    it("should reject confirmation before submit", () => {
      const order = createOrder();

      expect(isFailure(order.confirm())).toBe(true);
      expect(isFailure(order.fulfill())).toBe(true);
    });

    it("should cancel a draft order to cancelled", () => {
      const order = createOrder();
      const result = order.cancel();

      expect(isSuccess(result)).toBe(true);
      expect(order.status).toBe("cancelled");
    });

    it("should be terminal after cancel", () => {
      const order = createOrder();
      order.cancel();

      expect(isFailure(order.submit())).toBe(true);
      expect(isFailure(order.cancel())).toBe(true);
      expect(order.status).toBe("cancelled");
    });

    it("should be terminal after fulfill", () => {
      const order = createOrder();
      order.submit();
      order.confirm();
      order.fulfill();

      expect(isFailure(order.cancel())).toBe(true);
      expect(order.status).toBe("fulfilled");
    });
  });

  describe("historical snapshots", () => {
    it("should default customer, addresses, and payments to undefined", () => {
      const order = createOrder();

      expect(order.customer).toBeUndefined();
      expect(order.addresses).toBeUndefined();
      expect(order.payments).toBeUndefined();
    });

    it("should store customer and address facts on creation", () => {
      const order = createOrder({ customer, addresses: [address] });

      expect(order.customer?.customerId).toBe("cust-1");
      expect(order.customer?.contacts?.[0]?.value).toBe("jane@example.com");
      expect(order.addresses?.length).toBe(1);
      expect(order.addresses?.[0]?.role).toBe("shipping");
      expect(order.addresses?.[0]?.city).toBe("Rome");
    });

    it("should include historical facts in the snapshot", () => {
      const order = createOrder({ customer, addresses: [address] });
      const snapshot = order.snapshot();

      expect(snapshot.customer?.displayName).toBe("Jane Doe");
      expect(snapshot.addresses?.[0]?.countryCode).toBe("IT");
    });

    it("should defensively copy the customer contacts", () => {
      const contacts = [{ type: "email", value: "jane@example.com" }];
      const order = createOrder({ customer: { ...customer, contacts } });

      contacts[0] = { type: "email", value: "changed@example.com" };

      expect(order.customer?.contacts?.[0]?.value).toBe("jane@example.com");
    });

    it("should defensively copy the address lines", () => {
      const lines = ["1 Main St"];
      const order = createOrder({ addresses: [{ ...address, lines }] });

      lines[0] = "2 Altered St";

      expect(order.addresses?.[0]?.lines[0]).toBe("1 Main St");
    });

    it("should attach a payment fact after creation", () => {
      const order = createOrder();

      expect(order.payments).toBeUndefined();
      order.attachPayment(payment);

      expect(order.payments?.length).toBe(1);
      expect(order.payments![0]?.paymentId).toBe("pay-1");
      expect(order.payments![0]?.amount.amount).toBe(10000n);
      expect(order.payments![0]?.status).toBe("captured");
    });

    it("should include the attached payment fact in the snapshot", () => {
      const order = createOrder();
      order.attachPayment({ ...payment, status: "authorized" });

      const snapshot = order.snapshot();

      expect(snapshot.payments?.length).toBe(1);
      expect(snapshot.payments![0]?.status).toBe("authorized");
      expect(snapshot.payments![0]?.reference).toBe("ref-1");
    });

    it("should expose an immutable payment fact copy", () => {
      const order = createOrder();
      order.attachPayment(payment);

      const payments = order.payments;
      expect(payments?.length).toBe(1);
      expect(payments![0]?.paymentId).toBe("pay-1");
      // mutations to the returned array do not affect the aggregate
      payments?.push({ paymentId: "fake", amount: money(0n), status: "pending" });
      expect(order.payments?.length).toBe(1);
    });
  });

  describe("changeShippingDestination", () => {
    const laterCapturedAt = Instant.fromEpochMilliseconds(222222);
    const billingAddress: OrderAddressSnapshot = {
      addressId: "addr-2",
      role: "billing",
      lines: ["2 Via Roma"],
      city: "Milan",
      postalCode: "20100",
      countryCode: "IT",
      capturedAt,
    };
    const replacement = {
      addressId: "addr-9",
      lines: ["9 Corso Torino"],
      city: "Turin",
      administrativeArea: "TO",
      postalCode: "10100",
      countryCode: "IT",
      capturedAt: laterCapturedAt,
    };

    function createAddressedOrder(overrides?: Partial<OrderCreate>): Order {
      return createOrder({
        customer,
        addresses: [address, billingAddress],
        createdAt: Instant.fromEpochMilliseconds(1000),
        updatedAt: Instant.fromEpochMilliseconds(2000),
        ...overrides,
      });
    }

    function shippingOf(order: Order): OrderAddressSnapshot | undefined {
      return order.addresses?.find((candidate) => candidate.role === "shipping");
    }

    function billingOf(order: Order): OrderAddressSnapshot | undefined {
      return order.addresses?.find((candidate) => candidate.role === "billing");
    }

    it("should replace the shipping destination on a draft order", () => {
      const order = createAddressedOrder();
      const result = order.changeShippingDestination(replacement);

      expect(isSuccess(result)).toBe(true);
      const shipping = shippingOf(order);
      expect(shipping?.addressId).toBe("addr-9");
      expect(shipping?.role).toBe("shipping");
      expect(shipping?.lines).toEqual(["9 Corso Torino"]);
      expect(shipping?.city).toBe("Turin");
      expect(shipping?.administrativeArea).toBe("TO");
      expect(shipping?.postalCode).toBe("10100");
      expect(shipping?.countryCode).toBe("IT");
      expect(shipping?.capturedAt.epochMilliseconds).toBe(222222);
      expect(order.updatedAt.epochMilliseconds).toBeGreaterThan(2000);
      expect(order.createdAt.epochMilliseconds).toBe(1000);
    });

    it("should replace the shipping destination on a pending order", () => {
      const order = createAddressedOrder();
      order.submit();
      const result = order.changeShippingDestination(replacement);

      expect(isSuccess(result)).toBe(true);
      expect(order.status).toBe("pending");
      expect(shippingOf(order)?.city).toBe("Turin");
    });

    it("should reject the change on a confirmed order", () => {
      const order = createAddressedOrder();
      order.submit();
      order.confirm();
      const updatedAtBefore = order.updatedAt.epochMilliseconds;
      const result = order.changeShippingDestination(replacement);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:shipping_destination_immutable");
      }
      expect(shippingOf(order)?.addressId).toBe("addr-1");
      expect(order.updatedAt.epochMilliseconds).toBe(updatedAtBefore);
    });

    it("should reject the change on a fulfilled order", () => {
      const order = createAddressedOrder();
      order.submit();
      order.confirm();
      order.fulfill();
      const updatedAtBefore = order.updatedAt.epochMilliseconds;
      const result = order.changeShippingDestination(replacement);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:shipping_destination_immutable");
      }
      expect(shippingOf(order)?.city).toBe("Rome");
      expect(order.updatedAt.epochMilliseconds).toBe(updatedAtBefore);
    });

    it("should reject the change on a cancelled order", () => {
      const order = createAddressedOrder();
      order.cancel();
      const updatedAtBefore = order.updatedAt.epochMilliseconds;
      const result = order.changeShippingDestination(replacement);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:shipping_destination_immutable");
      }
      expect(shippingOf(order)?.city).toBe("Rome");
      expect(order.updatedAt.epochMilliseconds).toBe(updatedAtBefore);
    });

    it("should succeed as a no-op when the destination is structurally identical", () => {
      const order = createAddressedOrder();
      const identical = {
        addressId: "addr-1",
        lines: ["1 Main St"],
        city: "Rome",
        administrativeArea: "RM",
        postalCode: "00100",
        countryCode: "IT",
        capturedAt,
      };
      const result = order.changeShippingDestination(identical);

      expect(isSuccess(result)).toBe(true);
      expect(shippingOf(order)?.addressId).toBe("addr-1");
      expect(shippingOf(order)?.lines).toEqual(["1 Main St"]);
      expect(order.updatedAt.epochMilliseconds).toBe(2000);
    });

    it("should reject the change when no shipping destination exists", () => {
      const order = createAddressedOrder({ addresses: [billingAddress] });
      const result = order.changeShippingDestination(replacement);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:ambiguous_shipping_destination");
      }
      expect(order.updatedAt.epochMilliseconds).toBe(2000);
    });

    it("should reject the change when the order has no addresses at all", () => {
      const order = createAddressedOrder({ addresses: undefined });
      const result = order.changeShippingDestination(replacement);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:ambiguous_shipping_destination");
      }
    });

    it("should reject the change when more than one shipping destination exists", () => {
      const order = createAddressedOrder({
        addresses: [address, { ...address, addressId: "addr-3" }, billingAddress],
      });
      const result = order.changeShippingDestination(replacement);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("order:ambiguous_shipping_destination");
      }
      expect(order.addresses?.length).toBe(3);
      expect(order.updatedAt.epochMilliseconds).toBe(2000);
    });

    it("should not modify any other state when replacing", () => {
      const order = createAddressedOrder({ meta: { channel: "web" } });
      order.attachPayment(payment);
      const beforeItems = order.items;
      const result = order.changeShippingDestination(replacement);

      expect(isSuccess(result)).toBe(true);
      expect(billingOf(order)).toEqual(billingAddress);
      expect(order.customer?.customerId).toBe("cust-1");
      expect(order.customer?.displayName).toBe("Jane Doe");
      expect(order.items).toHaveLength(beforeItems.length);
      expect(order.items[0]?.id).toBe("item-1");
      expect(amount(order.price.total)).toBe(10000n);
      expect(order.payments?.length).toBe(1);
      expect(order.payments![0]?.status).toBe("captured");
      expect(order.meta).toEqual({ channel: "web" });
      expect(order.status).toBe("draft");
    });

    it("should defensively copy the replacement destination", () => {
      const order = createAddressedOrder();
      const input = {
        addressId: "addr-9",
        lines: ["9 Corso Torino"],
        city: "Turin",
        administrativeArea: "TO",
        postalCode: "10100",
        countryCode: "IT",
        capturedAt: laterCapturedAt,
      };
      const result = order.changeShippingDestination(input);

      input.lines[0] = "2 Altered St";
      input.city = "Altered";

      expect(isSuccess(result)).toBe(true);
      expect(shippingOf(order)?.lines).toEqual(["9 Corso Torino"]);
      expect(shippingOf(order)?.city).toBe("Turin");
    });
  });
});