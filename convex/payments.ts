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
    const updatedAt = Math.max(
      Date.now(),
      Number(existing?.updatedAt || 0) + (existing ? 1 : 0),
      Number(args.updatedAt || 0),
    );
    if (!existing) return await ctx.db.insert("payments", { ...args, updatedAt });
    await ctx.db.replace(existing._id, { ...args, updatedAt });
    return existing._id;
  },
});

export const deletePayment = mutation({
  args: paymentArgs.fields,
  handler: async (ctx, args) => {
    const existing = await findPayment(ctx, args.localId);
    if (!existing) return await ctx.db.insert("payments", {
      ...args,
      updatedAt: Math.max(Date.now(), Number(args.updatedAt || 0)),
      isDeleted: true,
    });
    await ctx.db.replace(existing._id, {
      ...args,
      updatedAt: Math.max(Date.now(), Number(existing.updatedAt || 0) + 1, Number(args.updatedAt || 0)),
      isDeleted: true,
    });
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
