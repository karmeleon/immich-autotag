import fsPromises from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
    init,
    getAlbumInfo,
    searchAssets,
    AssetTypeEnum,
    deleteTag,
    type AssetResponseDto,
    type MetadataSearchDto,
    downloadAsset,
    getAllTags,
    createTag,
    bulkTagAssets,
} from '@immich/sdk';
import { load } from 'js-yaml';
// @ts-ignore
import { generateRandomDarkColor } from 'make-random-color';
import pLimit from 'p-limit';
import sharp from 'sharp';

import { AUTO_TAG_NAME } from './constants.ts';
import {
    cliFlagsParser,
    configSchemaParser,
    envVarsParser,
    type Config,
    type DecisionsAPI,
    type DecisionsResponse,
} from './types.ts';

async function* createAssetSearch(albumQuery: MetadataSearchDto, maxItems: number) {
    let nextCursor = null;
    let numReturnedAssets = 0;
    do {
        const response = await searchAssets({
            metadataSearchDto: { ...albumQuery, ...(nextCursor ? { cursor: nextCursor } : {}) },
        });
        const assets = response.assets;
        nextCursor = assets.nextCursor as string;

        if (assets.items.length <= maxItems) {
            numReturnedAssets += assets.items.length;
            yield* assets.items;
        } else {
            yield* assets.items.slice(0, maxItems - numReturnedAssets);
            return;
        }
    } while (nextCursor != null);
}

function getQueryBody(
    bodyType: DecisionsAPI,
    tags: Record<string, string>,
    model: string,
    guidance: string,
    image: Buffer,
): string {
    const imageUUID = crypto.randomUUID();
    const imageB64 = image.toString('base64');
    const stateString = `Please use the following image as a reference for the following questions. Your responses will be used to tag this image. ${guidance}`;

    const questions = Object.fromEntries(
        Object.entries(tags).map(([tag, description]) => [
            tag,
            {
                instructions: `Does this image depict ${description}?`,
                type: 'noul',
            },
        ]),
    );

    let queryBody: any = {
        model,
    };

    switch (bodyType) {
        case 'OpenSourceSystemOne':
            queryBody = {
                ...queryBody,
                state: stateString,
                images: [`data:image/jpeg;base64,${imageB64}`],
                questions,
            };
            break;
        case 'AlphaDecisions':
            queryBody = {
                ...queryBody,
                state: [
                    stateString,
                    {
                        type: 'image_url',
                        image_url: { url: `data:image/jpeg;base64,${imageB64}` },
                    },
                ],
                questions,
            };
            break;
        case 'SystemAlpha':
            console.warn('The SystemAlpha API is untested, yolo');
            queryBody = {
                ...queryBody,
                state: `${stateString} ${imageUUID}`,
                assets: {
                    [imageUUID]: {
                        type: 'image',
                        // assumes the Buffer is a jpeg. probably ok
                        format: 'jpeg',
                        data_base64: imageB64,
                    },
                },
                questions,
            };
            break;
        case 'GoogleDecisions':
            console.warn('The Google Decisions API is untested, yolo');
            queryBody = {
                ...queryBody,
                input: [
                    { type: 'text', text: stateString },
                    {
                        type: 'image',
                        data: imageB64,
                        mime_type: 'image/jpeg',
                        resolution: 'medium',
                    },
                ],
                questions,
            };
            break;
        case 'OpenAIDecisions':
            // their api is weird and i don't like it
            throw new Error('The OpenAI decisions model is not supported, use something else');
    }

    return JSON.stringify(queryBody);
}

interface ProcessAssetOptions {
    asset: AssetResponseDto;
    dryRun: boolean;
    tagMap: Map<string, string>;
    config: Config;
    apiKey: string | undefined;
}

async function processAsset({ asset, dryRun, tagMap, config, apiKey }: ProcessAssetOptions) {
    const assetURL = new URL(config.immich.baseUrl);
    assetURL.pathname = `/photos/${asset.id}`;

    try {
        const assetBlob = await downloadAsset({ id: asset.id });
        const resizedImage = await sharp(await assetBlob.arrayBuffer())
            .resize({ width: 1024, height: 1024, fit: 'contain' })
            .jpeg()
            .toBuffer();

        const decisions = await fetch(config.decisions.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: getQueryBody(
                config.decisions.type,
                config.tags,
                config.decisions.model,
                config.decisions.guidance ?? '',
                resizedImage,
            ),
        });

        if (!decisions.ok) {
            console.error(await decisions.text());
            process.exit();
        }

        const identifiedTags = Object.entries(
            ((await decisions.json()) as DecisionsResponse).answers,
        )
            .filter(([_, decision]) => decision.noul >= config.decisions.minConfidence)
            .map(([key, decision]) => [key, Math.floor(decision.noul * 100)] as const);

        console.debug(`Processed ${assetURL.toString()}: ${identifiedTags}`);
        const tagsToAdd = identifiedTags.map((tag) => tagMap.get(tag[0])!);

        if (!dryRun) {
            await bulkTagAssets({ tagBulkAssetsDto: { assetIds: [asset.id], tagIds: tagsToAdd } });
        }
    } catch (e: any) {
        console.error(`Failed to process ${assetURL.toString()} -- got error ${e}`);
    }
}

async function getOrRegisterAllTags(dryRun: boolean, deleteTags: boolean, config: any) {
    const allAutoTags = new Set<string>([...Object.keys(config.tags), AUTO_TAG_NAME]);
    const allRegisteredTags = await getAllTags();
    const tagMap = new Map<string, string>(
        allRegisteredTags
            .filter((tag) => allAutoTags.has(tag.name))
            .map((tag) => [tag.name, tag.id]),
    );

    if (!dryRun) {
        if (deleteTags) {
            console.log('Deleting all existing tags that match desired tag names.');
            // just have to delete the root tag
            await deleteTag({ id: tagMap.get(AUTO_TAG_NAME)! });
            // await Promise.all(tagMap.entries().map(([_, id]) => deleteTag({ id })));
            tagMap.clear();
        }
        // find which tags are missing and create them
        const missingTags = allAutoTags.difference(tagMap);
        if (missingTags.has(AUTO_TAG_NAME)) {
            missingTags.delete(AUTO_TAG_NAME);
            // make sure the root tag exists so we can put everything else under it
            const rootTagID = (
                await createTag({
                    tagCreateDto: {
                        color: generateRandomDarkColor().slice(1),
                        name: AUTO_TAG_NAME,
                    },
                })
            ).id;
            tagMap.set(AUTO_TAG_NAME, rootTagID);
        }
        if (missingTags.size > 0) {
            const newTags = await Promise.all(
                Array.from(missingTags).map((tagName) =>
                    createTag({
                        tagCreateDto: {
                            // generated string starts with #, get rid of it
                            color: generateRandomDarkColor().slice(1),
                            name: tagName,
                            parentId: tagMap.get(AUTO_TAG_NAME)!,
                        },
                    }),
                ),
            );
            newTags.forEach((tag) => tagMap.set(tag.name, tag.id));
        }
    }

    return tagMap;
}

async function main() {
    const { values: rawValues } = parseArgs({
        options: {
            dryRun: {
                type: 'boolean',
            },
            maxItems: {
                type: 'string',
            },
            album: {
                type: 'string',
            },
            config: {
                type: 'string',
            },
            deleteTags: {
                type: 'boolean',
            },
        },
    });

    const values = cliFlagsParser.parse(rawValues);
    const config = configSchemaParser.parse(
        load(await fsPromises.readFile(values.config ?? './config.yaml', 'utf-8')),
    );
    const envVars = envVarsParser.parse(process.env);

    const immichAPIBaseUrl = new URL(config.immich.baseUrl);
    immichAPIBaseUrl.pathname = '/api';

    init({
        baseUrl: immichAPIBaseUrl.toString(),
        apiKey: envVars.IMMICH_API_KEY,
    });

    const album = await getAlbumInfo({
        id: values.album,
    });
    console.log(`Found album called "${album.albumName}"`);

    const tagMap = await getOrRegisterAllTags(
        values.dryRun ?? false,
        values.deleteTags ?? false,
        config,
    );

    const generator = createAssetSearch(
        {
            filter: {
                albumIds: {
                    any: [values.album],
                },
                type: {
                    eq: AssetTypeEnum.Image,
                },
            },
        },
        values.maxItems,
    );

    const assets = await Array.fromAsync(generator);
    const limit = pLimit(config.decisions.concurrency ?? 4);
    await Promise.all(
        assets.map((asset) =>
            limit(() =>
                processAsset({
                    asset,
                    dryRun: values.dryRun,
                    tagMap,
                    config,
                    apiKey: envVars.DECISIONS_API_KEY,
                }),
            ),
        ),
    );

    console.log('all done! :)');
}

if (import.meta.main) {
    main();
}
