import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const productOrderArgs = {
  key: v.string(),
  productLocalIds: v.array(v.string()),
  productIds: v.array(v.number()),
  updatedAt: v.number(),
};

export const upsertProductOrder = mutation({
  args: productOrderArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("productOrders")
      .withIndex("by_key", q => q.eq("key", args.key)).unique();

    if (existing && existing.updatedAt > args.updatedAt) {
      return { applied: false, updatedAt: existing.updatedAt };
    }

    if (existing) {
      await ctx.db.replace(existing._id, args);
      return { applied: true, updatedAt: args.updatedAt };
    }

    await ctx.db.insert("productOrders", args);
    return { applied: true, updatedAt: args.updatedAt };
  },
});

export const getProductOrder = query({
  args: { key: v.string() },
  handler: async (ctx, args) => ctx.db.query("productOrders")
    .withIndex("by_key", q => q.eq("key", args.key)).unique(),
});
