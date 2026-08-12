import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { invoiceFields } from "./schema";

const invoiceArgs = v.object(invoiceFields);

export const createInvoice = mutation({
  args: invoiceArgs.fields,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique();

    if (existing) {
      return { invoiceId: existing._id, created: false };
    }

    const invoiceId = await ctx.db.insert("invoices", args);
    return { invoiceId, created: true };
  },
});

export const updateInvoice = mutation({
  args: invoiceArgs.fields,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique();

    if (!existing) {
      throw new Error("Invoice not found");
    }

    await ctx.db.replace(existing._id, args);
    return existing._id;
  },
});

export const deleteInvoice = mutation({
  args: { localId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique();

    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const getInvoices = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 1000), 5000));
    return await ctx.db.query("invoices").order("desc").take(limit);
  },
});
