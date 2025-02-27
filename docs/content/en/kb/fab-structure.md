---
title: 'FAB Structure'
category: Knowledge Base
position: 390
---

# FAB Structure

A FAB is a ZIP file with the given structure:

<p align="center">
  <img
    width="450px"
    max-width="100%"
    alt="FAB Structure"
    src="https://user-images.githubusercontent.com/23264/64143562-f9333180-ce53-11e9-9058-4d1d961a1d35.png"
  />
</p>

Any server-side components get compiled down to a single server-side file, `server.js`. All client-side assets are zipped into the `_assets` directory. Between these two, they represent an entire snapshot of a release.

### `server.js`

A `V8:Isolate`-compatible single-file build of your server-side logic.

Exposes two entry points:

```js
const getProdSettings = () => {
  return {
    // All production settings are bundled into the FAB here,
    // ensuring predictable behaviour regardless of host.
    // These are returned as a separate entry point, however,
    // so that any encrypted variables can be decrypted
    // by the host before being passed through to the render.
  }
}

const render = async (request, settings) => {
  // request: a fetch.Request object
  // settings: your production settings plus any
  //           environment-specific overrides

  const { body, statusCode, headers } = await myApp.render(request, settings)

  // return a fetch.Response object with the full data.
  // For streaming responses, see https://fab.dev/kb/streaming
  return new Response(body, { statusCode, headers })
}

module.exports = { render, getProdSettings }
```

### `_assets` directory

Extracted from the FAB and hosted separately on a static file server like S3 at deploy time, then routed there by a CDN or load balancer using the URL path `/_assets/*`. This happens _before your request even reaches your FAB_, which means that the name "_assets" cannot be changed. More importantly, and assets are recommended to be served with `cache-control: immutable` headers. As such, files in this directory \_must_ be fingerprinted so they do not clash from release to release.

Since there can be no static assets _outside_ the `/_assets` directory, and all assets must be fingerprinted, we provide `@fab/compile` which takes a more user-friendly format and generates a spec-compliant FAB.

### fab.zip itself

FAB tooling uses [`deterministic-zip`](https://npm.im/deterministic-zip) to create this file, which means that two FABs with identical contents will themselves be identical. See [Production](/kb/production) for more info.
