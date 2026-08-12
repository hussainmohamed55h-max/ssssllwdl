import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { categoryFields } from "./schema";

const categoryArgs = v.object(categoryFields);

export const createCategory = mutation({
  args: categoryArgs.fields,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("categories")
      .withIndex("by_localId", q => q.eq("localId", args.localId)).unique();
    if (existing) return { categoryId: existing._id, created: false };
    return {
      categoryId: await ctx.db.insert("categories", {
        ...args,
        updatedAt: args.updatedAt ?? Date.now(),
      }),
      created: true,
    };
  },
});

export const updateCategory = mutation({
  args: categoryArgs.fields,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("categories")
      .withIndex("by_localId", q => q.eq("localId", args.localId)).unique();
    if (!existing) throw new Error("Category not found");
    await ctx.db.replace(existing._id, {
      ...args,
      updatedAt: args.updatedAt ?? Date.now(),
    });
    return existing._id;
  },
});

export const deleteCategory = mutation({
  args: { localId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("categories")
      .withIndex("by_localId", q => q.eq("localId", args.localId)).unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const getCategories = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => ctx.db.query("categories").order("desc")
    .take(Math.max(1, Math.min(Math.floor(args.limit ?? 1000), 5000))),
});
