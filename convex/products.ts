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
    await ctx.db.replace(existing._id, {
      ...args,
      updatedAt: args.updatedAt ?? Date.now(),
    });
    return existing._id;
  },
});

export const deleteProduct = mutation({
  args: { localId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("products")
      .withIndex("by_localId", q => q.eq("localId", args.localId)).unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const getProducts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => ctx.db.query("products").order("desc")
    .take(Math.max(1, Math.min(Math.floor(args.limit ?? 1000), 5000))),
});
