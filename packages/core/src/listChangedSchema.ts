import * as z from 'zod/v4';

/** Runtime validation shared by all list-changed subscription helpers. */
export const ListChangedOptionsBaseSchema = z.object({
    autoRefresh: z.boolean().default(true),
    debounceMs: z.number().int().nonnegative().default(300)
});
