## [0.2.0](https://github.com/Runivox/prompt-helm-sdk-node/compare/v0.1.0...v0.2.0) (2026-06-06)

### ⚠ BREAKING CHANGES

* error fields renamed: `code` → `errorCode`, `correlationId` → `requestId`

### Bug Fixes

* parse the real gateway error envelope `{ statusCode, errorCode, message, timestamp, requestId }`
* standardize User-Agent to `prompt-helm-sdk-node/<version>`

## [0.1.0](https://github.com/Runivox/prompt-helm-sdk-node/compare/v0.0.0...v0.1.0) (2026-05-12)

### Features

* support customizable userAgent for app identification ([1ab2363](https://github.com/Runivox/prompt-helm-sdk-node/commit/1ab23630aa9b689285d54a81edcd355049213a2b))

### Bug Fixes

* **ci:** add conventional-changelog-conventionalcommits peer dep ([df2c5ce](https://github.com/Runivox/prompt-helm-sdk-node/commit/df2c5cecb91b3a03eb531504fbd758513c151d73))
* **ci:** expose npm token as NODE_AUTH_TOKEN to satisfy setup-node .npmrc ([bbb9b72](https://github.com/Runivox/prompt-helm-sdk-node/commit/bbb9b728e03ef394e8b016cf8801a5d82295d7c9))
* **ci:** regenerate lock file and pin release job to node 22 ([ce0f843](https://github.com/Runivox/prompt-helm-sdk-node/commit/ce0f843f802461401ca14f6ba2d1d8d1350777bc))
* **npm:** set publishConfig access to public for scoped package ([3868bf3](https://github.com/Runivox/prompt-helm-sdk-node/commit/3868bf337bbcac7c9dce88772373c725da7c1100))
