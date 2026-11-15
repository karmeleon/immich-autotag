import { z } from 'zod';

const decisionsAPIEnum = z.enum([
    // used by omlx, llama.cpp
    'OpenSourceSystemOne',
    // used by openrouter
    'AlphaDecisions',
    // first-party Jev
    'SystemAlpha',
    'OpenAIDecisions',
    'GoogleDecisions',
]);

export type DecisionsAPI = z.infer<typeof decisionsAPIEnum>;

export const configSchemaParser = z.object({
    immich: z.object({
        baseUrl: z.url(),
    }),
    decisions: z.object({
        url: z.url(),
        model: z.string(),
        type: decisionsAPIEnum,
        minConfidence: z.number().gte(0).lte(1).optional().default(0.85),
        concurrency: z.number().gte(1).multipleOf(1).optional().default(4),
        guidance: z.string().optional(),
    }),
    tags: z.record(z.string(), z.string()),
});

export type Config = z.infer<typeof configSchemaParser>;

export const cliFlagsParser = z.object({
    dryRun: z.boolean().default(false),
    maxItems: z.coerce.number().default(Infinity),
    album: z.uuid(),
    config: z.string().default('./config.yaml'),
    deleteTags: z.boolean().default(false),
});

export const envVarsParser = z.object({
    IMMICH_API_KEY: z.string(),
    DECISIONS_API_KEY: z.string().optional(),
});

export interface DecisionsResponse {
    answers: Record<string, { noul: number }>;
}
