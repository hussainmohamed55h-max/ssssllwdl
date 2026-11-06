import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const PRODUCTS_ADMIN_SETTINGS_KEY = "products-admin-code";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const getProductsAdminSettings = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("appSettings")
      .withIndex("by_key", q => q.eq("key", PRODUCTS_ADMIN_SETTINGS_KEY))
      .unique();
  },
});

export const upsertProductsAdminSettings = mutation({
  args: { productsAdminCodeHash: v.string() },
  handler: async (ctx, args) => {
    const productsAdminCodeHash = args.productsAdminCodeHash.trim().toLowerCase();
    if (!SHA256_PATTERN.test(productsAdminCodeHash)) {
      throw new Error("Invalid products admin code hash");
    }

    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", q => q.eq("key", PRODUCTS_ADMIN_SETTINGS_KEY))
      .unique();
    const updatedAt = Math.max(Date.now(), Number(existing?.updatedAt || 0) + 1);
    const settings = {
      key: PRODUCTS_ADMIN_SETTINGS_KEY,
      productsAdminCodeHash,
      updatedAt,
    };

    if (existing) {
      await ctx.db.replace(existing._id, settings);
      return { settingsId: existing._id, updatedAt };
    }
    return {
      settingsId: await ctx.db.insert("appSettings", settings),
      updatedAt,
    };
  },
});
