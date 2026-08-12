import { query } from "./_generated/server";

export const healthCheck = query({
  args: {},
  handler: async () => {
    return {
      ok: true,
      service: "convex",
    };
  },
});
