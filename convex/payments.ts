import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paymentFields } from "./schema";

const paymentArgs = v.object(paymentFields);

async function findPayment(ctx: any, localId: string) {
  return await ctx.db
    .query("payments")
    .withIndex("by_localId", (q: any) => q.eq("localId", localId))
    .unique();
}

export const upsertPayment = mutation({
  args: paymentArgs.fields,
  handler: async (ctx, args) => {
    const existing = await findPayment(ctx, args.localId);
    if (!existing) return await ctx.db.insert("payments", args);
    if (Number(existing.updatedAt || 0) > args.updatedAt) return existing._id;
    await ctx.db.replace(existing._id, args);
    return existing._id;
  },
});

export const deletePayment = mutation({
  args: paymentArgs.fields,
  handler: async (ctx, args) => {
    const existing = await findPayment(ctx, args.localId);
    if (!existing) return await ctx.db.insert("payments", { ...args, isDeleted: true });
    if (Number(existing.updatedAt || 0) > args.updatedAt) return existing._id;
    await ctx.db.replace(existing._id, { ...args, isDeleted: true });
    return existing._id;
  },
});

export const getPayments = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 5000), 5000));
    return await ctx.db.query("payments").order("desc").take(limit);
  },
});
