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
    const updatedAt = Math.max(
      Date.now(),
      Number(existing?.updatedAt || 0) + (existing ? 1 : 0),
      Number(args.updatedAt || 0),
    );
    if (!existing) return await ctx.db.insert("customers", { ...args, updatedAt });

    await ctx.db.replace(existing._id, {
      ...args,
      localId: existing.localId,
      archivedDebt: Number(existing.archivedDebt || 0),
      updatedAt,
    });
    return existing._id;
  },
});

export const deleteCustomer = mutation({
  args: customerArgs.fields,
  handler: async (ctx, args) => {
    const existing = await findCustomer(ctx, args.localId, args.nameKey);
    if (!existing) {
      return await ctx.db.insert("customers", {
        ...args,
        updatedAt: Math.max(Date.now(), Number(args.updatedAt || 0)),
        isDeleted: true,
      });
    }

    const { _id, _creationTime, ...existingFields } = existing;
    await ctx.db.replace(existing._id, {
      ...existingFields,
      updatedAt: Math.max(Date.now(), Number(existing.updatedAt || 0) + 1, Number(args.updatedAt || 0)),
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
