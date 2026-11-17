import { z } from 'zod';

const decisionsAPIEnum = z.enum([
    // used by omlx, llama.cpp
    'OpenSourceSystemOne',
    // used by openrouter
    'AlphaDecisions',
    // first-party Jev (untested)
    'SystemAlpha',
    // openai (unsupported)
    'OpenAIDecisions',
    // google gemini decisions (untested)
    'GoogleDecisions',
]);

export type DecisionsAPI = z.infer<typeof decisionsAPIEnum>;

export const configSchemaParser = z.object({
    immich: z.object({
        // base URL of your immich instance, e.g. http://localhost:2283
        baseUrl: z.url(),
        // create one in Account Settings > API Keys > New API Key
        apiKey: z.string(`Missing Immich API key. Requires the following permissions:
- asset.read, asset.download
- album.read
- tag.*`),
    }),
    decisions: z.object({
        // URL of the decisions endpoint, e.g. https://openrouter.ai/api/alpha/decisions or https://api.typesafe.ai/v1/systemone
        url: z.url(),
        // model name to use, e.g. liquid/d1.1 or jev-latest
        model: z.string(),
        // Bearer token for your endpoint (may be empty for self-hosted LAN endpoints)
        apiKey: z.string().optional(),
        // API endpoint type -- see decisionsAPIEnum above to decide which is yours
        type: decisionsAPIEnum,
        // minimum confidence score to tag an image. 0.85 seems like a good balance in my experience
        minConfidence: z.number().gte(0).lte(1).optional().default(0.85),
        // how many images to tag concurrently. keep low for underprovisioned immich servers or local decision models on weak hardware,
        // raise it high for cloud-hosted versions
        concurrency: z.number().gte(1).multipleOf(1).optional().default(4),
        // an optional string to append to the default guidance message.
        guidance: z.string().optional(),
    }),
    // one or more tags to apply, in `tagName: tag description` format
    tags: z.record(z.string(), z.string()),
});

export type Config = z.infer<typeof configSchemaParser>;

export const cliFlagsParser = z.object({
    dryRun: z.boolean().default(false),
    maxItems: z.coerce.number().default(Infinity),
    album: z.uuid(),
    config: z.string().default('./config.yaml'),
    deleteTags: z.boolean().default(false),
    help: z.boolean().default(false),
});

export interface DecisionsResponse {
    answers: Record<string, { noul: number }>;
}
