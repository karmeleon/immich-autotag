# immich-autotag

a silly little script to automatically classify images of my cat

100% created by a human

## running

```bash
$ git clone https://github.com/karmeleon/immich-autotag.git
$ cd immich-autotag
# create config.yaml, see below
$ npm i
# find the UUID of an album by visiting it in the web UI and copying it from the URL
$ node src/main.ts --album [ALBUM_UUID]
```

## config.yaml

here's a starter config, see `configSchemaParser` in `src/types.ts` for the full schema

if you've got an apple silicon mac with >= 16GB of memory, consider using [omlx](https://omlx.ai/) to self-host [d1-2b](https://huggingface.co/LiquidAI/d1-2B-MLX-8bit). omlx can actually answer multiple questions in a single forward pass unlike llama.cpp, and i find it gives shockingly good results for how cheap and fast it is.

```yaml
immich:
    baseUrl: https://immich.wn.zone
    # create with asset.read, asset.download, album.read, and tag.* permissions
    apiKey: your-immich-api-key-here
decisions:
    url: https://openrouter.ai/api/alpha/decisions
    # this model is fast, cheap, and works well in my experience
    model: liquid/d1.1
    # most endpoint types are supported, see configSchemaParser
    type: AlphaDecisions
    apiKey: your-openrouter-key-here
tags:
    loaf: a cat sitting like a "loaf" with its legs tucked underneath it and its tail wrapped around its body
    circle: a cat laying down on its side, curled up so that the outline of its body forms a circle
    upsideDown: a cat laying upside-down, with its belly facing upwards
```
