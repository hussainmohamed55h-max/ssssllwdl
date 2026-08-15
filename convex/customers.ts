import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { customerFields } from "./schema";

const customerArgs = v.object(customerFields);

async function findCustomer(ctx: any, localId: string, nameKey: string) {
  const byLocalId = await ctx.db
    .query("customers")
    .withIndex("by_localId", (q: any) => q.eq("localId", localId))
    .unique();
  if (byLocalId) return byLocalId;
  return await ctx.db
    .query("customers")
    .withIndex("by_nameKey", (q: any) => q.eq("nameKey", nameKey))
    .unique();
}

export const upsertCustomer = mutation({
  args: customerArgs.fields,
  handler: async (ctx, args) => {
    const existing = await findCustomer(ctx, args.localId, args.nameKey);
    if (!existing) return await ctx.db.insert("customers", args);
    if (Number(existing.updatedAt || 0) > args.updatedAt) return existing._id;

    await ctx.db.replace(existing._id, {
      ...args,
      localId: existing.localId,
    });
    return existing._id;
  },
});

export const deleteCustomer = mutation({
  args: customerArgs.fields,
  handler: async (ctx, args) => {
    const existing = await findCustomer(ctx, args.localId, args.nameKey);
    if (!existing) {
      return await ctx.db.insert("customers", { ...args, isDeleted: true });
    }
    if (Number(existing.updatedAt || 0) > args.updatedAt) return existing._id;

    const { _id, _creationTime, ...existingFields } = existing;
    await ctx.db.replace(existing._id, {
      ...existingFields,
      updatedAt: args.updatedAt,
      isDeleted: true,
    });
    return existing._id;
  },
});

export const getCustomers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 5000), 5000));
    return await ctx.db.query("customers").order("desc").take(limit);
  },
});
