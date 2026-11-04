import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { invoiceFields } from "./schema";

const invoiceArgs = v.object(invoiceFields);
const INVOICE_RETENTION_MS = 40 * 24 * 60 * 60 * 1000;

function normalizeCustomerNameKey(name: string) {
  return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

async function findInvoiceCustomer(ctx: any, invoice: any) {
  if (invoice.customerLocalId) {
    const byLocalId = await ctx.db
      .query("customers")
      .withIndex("by_localId", (q: any) => q.eq("localId", invoice.customerLocalId))
      .first();
    if (byLocalId && !byLocalId.isDeleted) return byLocalId;
  }

  const nameKey = normalizeCustomerNameKey(invoice.customer);
  if (!nameKey) return null;
  const byName = await ctx.db
    .query("customers")
    .withIndex("by_nameKey", (q: any) => q.eq("nameKey", nameKey))
    .first();
  return byName && !byName.isDeleted ? byName : null;
}

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

export const pruneExpiredInvoices = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cutoff = now - INVOICE_RETENTION_MS;
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 100));
    const invoices = await ctx.db.query("invoices").order("asc").take(5000);
    const expired = invoices
      .filter((invoice: any) => Number(invoice.createdAt || invoice._creationTime || 0) <= cutoff)
      .slice(0, limit);
    const customerAdjustments = new Map<string, { customer: any; amount: number }>();
    const deletable: any[] = [];
    let skippedUnpaid = 0;

    for (const invoice of expired) {
      const amountToPreserve = invoice.status === "واصل" ? 0 : Math.max(0, Number(invoice.total || 0));
      if (amountToPreserve > 0) {
        const customer = await findInvoiceCustomer(ctx, invoice);
        if (!customer) {
          skippedUnpaid += 1;
          continue;
        }
        const key = String(customer._id);
        const existing = customerAdjustments.get(key);
        customerAdjustments.set(key, {
          customer,
          amount: Number(existing?.amount || 0) + amountToPreserve,
        });
      }
      deletable.push(invoice);
    }

    for (const { customer, amount } of customerAdjustments.values()) {
      await ctx.db.patch(customer._id, {
        archivedDebt: Number(customer.archivedDebt || 0) + amount,
        updatedAt: now,
      });
    }
    for (const invoice of deletable) await ctx.db.delete(invoice._id);

    const remainingExpired = expired.length === limit && deletable.length > 0;
    return {
      deletedCount: deletable.length,
      deletedLocalIds: deletable.map((invoice) => invoice.localId),
      adjustedCustomerCount: customerAdjustments.size,
      skippedUnpaid,
      hasMore: remainingExpired,
    };
  },
});
