import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const generateProductImageUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const getProductImageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => await ctx.storage.getUrl(args.storageId),
});

export const deleteUnusedProductImage = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query("products")
      .filter((q) => q.eq(q.field("storageId"), args.storageId))
      .first();
    if (product) return false;

    const invoices = await ctx.db.query("invoices").take(5000);
    if (invoices.some((invoice) => invoice.items.some((item) => item.storageId === args.storageId))) {
      return false;
    }

    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) return false;
    await ctx.storage.delete(args.storageId);
    return true;
  },
});
