import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const invoiceItemValidator = v.object({
  id: v.number(),
  name: v.string(),
  price: v.number(),
  category: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageId: v.optional(v.union(v.string(), v.null())),
  thumbUrl: v.optional(v.string()),
  mediumUrl: v.optional(v.string()),
  deleteUrl: v.optional(v.string()),
  isHidden: v.optional(v.boolean()),
  qty: v.number(),
  note: v.optional(v.string()),
});

export const invoiceFields = {
  localId: v.string(),
  id: v.number(),
  customer: v.string(),
  phone: v.string(),
  date: v.string(),
  time: v.string(),
  status: v.string(),
  statusColor: v.string(),
  total: v.number(),
  items: v.array(invoiceItemValidator),
};

export const productFields = {
  localId: v.string(),
  id: v.number(),
  name: v.string(),
  price: v.number(),
  category: v.string(),
  imageUrl: v.string(),
  imageId: v.union(v.string(), v.null()),
  thumbUrl: v.string(),
  mediumUrl: v.string(),
  deleteUrl: v.string(),
  isHidden: v.optional(v.boolean()),
  updatedAt: v.optional(v.number()),
};

export const categoryFields = {
  localId: v.string(),
  id: v.number(),
  name: v.string(),
  updatedAt: v.optional(v.number()),
};

export default defineSchema({
  invoices: defineTable(invoiceFields).index("by_localId", ["localId"]),
  products: defineTable(productFields).index("by_localId", ["localId"]),
  categories: defineTable(categoryFields).index("by_localId", ["localId"]),
});
