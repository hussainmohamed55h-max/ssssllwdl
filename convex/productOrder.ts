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

    const serverUpdatedAt = Math.max(
      Date.now(),
      Number(existing?.updatedAt ?? 0) + 1,
    );
    const serverOrder = { ...args, updatedAt: serverUpdatedAt };

    if (existing) {
      await ctx.db.replace(existing._id, serverOrder);
      return { applied: true, updatedAt: serverUpdatedAt };
    }

    await ctx.db.insert("productOrders", serverOrder);
    return { applied: true, updatedAt: serverUpdatedAt };
  },
});

export const getProductOrder = query({
  args: { key: v.string() },
  handler: async (ctx, args) => ctx.db.query("productOrders")
    .withIndex("by_key", q => q.eq("key", args.key)).unique(),
});
