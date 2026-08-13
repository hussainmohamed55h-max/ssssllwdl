import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { productFields } from "./schema";

const productArgs = v.object(productFields);

export const createProduct = mutation({
  args: productArgs.fields,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("products")
      .withIndex("by_localId", q => q.eq("localId", args.localId)).unique();
    if (existing) return { productId: existing._id, created: false };
    return {
      productId: await ctx.db.insert("products", {
        ...args,
        updatedAt: args.updatedAt ?? Date.now(),
      }),
      created: true,
    };
  },
});

export const updateProduct = mutation({
  args: productArgs.fields,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("products")
      .withIndex("by_localId", q => q.eq("localId", args.localId)).unique();
    if (!existing) throw new Error("Product not found");
    const previousStorageId = existing.storageId;
    await ctx.db.replace(existing._id, {
      ...args,
      updatedAt: args.updatedAt ?? Date.now(),
    });
    if (previousStorageId && previousStorageId !== args.storageId) {
      const otherProduct = await ctx.db.query("products")
        .filter(q => q.eq(q.field("storageId"), previousStorageId)).first();
      const invoices = await ctx.db.query("invoices").take(5000);
      const usedByInvoice = invoices.some(invoice =>
        invoice.items.some(item => item.storageId === previousStorageId)
      );
      if (!otherProduct && !usedByInvoice && await ctx.db.system.get(previousStorageId)) {
        await ctx.storage.delete(previousStorageId);
      }
    }
    return existing._id;
  },
});

export const deleteProduct = mutation({
  args: { localId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("products")
      .withIndex("by_localId", q => q.eq("localId", args.localId)).unique();
    if (!existing) return false;
    const storageId = existing.storageId;
    await ctx.db.delete(existing._id);
    if (storageId) {
      const otherProduct = await ctx.db.query("products")
        .filter(q => q.eq(q.field("storageId"), storageId)).first();
      const invoices = await ctx.db.query("invoices").take(5000);
      const usedByInvoice = invoices.some(invoice =>
        invoice.items.some(item => item.storageId === storageId)
      );
      if (!otherProduct && !usedByInvoice && await ctx.db.system.get(storageId)) {
        await ctx.storage.delete(storageId);
      }
    }
    return true;
  },
});

export const getProducts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => ctx.db.query("products").order("desc")
    .take(Math.max(1, Math.min(Math.floor(args.limit ?? 1000), 5000))),
});
