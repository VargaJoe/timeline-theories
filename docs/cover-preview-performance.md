# Cover preview performance and twelve posters

PR #64 retains React/Vite, Netlify Functions and SenseNet image storage. The follow-up removes separate permission probes from the application API and supports 1–12 selected posters with one visitor image.

## Preview data flow

`POST /api/v1/images/preview-sources` accepts `{ownerId, sourceIds}` with at most 12 distinct IDs and a 16 KiB request limit. It returns a fresh owner revision plus minimal caller-readable original descriptors, in source order. Source reads use at most four workers; any unreadable source fails the complete response. Version validators include actual repository `ModificationDate` and `Version` as well as binary metadata; a download URL alone is not a change stamp.

The browser keeps original Blobs only inside the mounted editor and its original authentication context, bounded to 12 entries and 32 MiB. Each preparation first renews the current source metadata and read access. Unchanged originals are reused; changed versions are downloaded again. Permission/context changes, invalid metadata, cancellation and disposal invalidate reuse. Private original bytes are never persisted in jobs, application Blobs or browser storage. Generated output hashes still describe the actual image bytes.

Original download routes read minimal metadata followed by the caller-authorized binary GET. Preparing a preview no longer performs a separate full snapshot lookup for each poster. Publication retains the fresh owner's optimistic revision and the existing same-intent recovery protocol.

## Local comparison

The same four existing originals, same local Docker target and real Editor login were measured before and after the change. This measures **preview creation**, separately from publication.

| Measurement | Before | After |
| --- | ---: | ---: |
| First preparation | 8.902 s | 4.968 s |
| Repeat preparation in the same editor | 8.043 s | 1.327 s |
| Additional original downloads on repeat | 4 | 0 |
| Local decode, drawing, encoding and hashing from already downloaded originals | 0.178–0.191 s | 0.201–0.203 s |

Private evidence: `deployment/.local/preview-latency-2026-11-16.json` and `preview-latency-after-2026-11-16.json`. The read-only probe blocked mutation routes. These timings describe this local environment.

The document's existing `delayed-scroll-restoration-polyfill@0.1.1` is also served locally. The published npm archive integrity and the old CDN script bytes were verified; the unchanged script, MIT license and provenance are under `client/public/vendor/delayed-scroll-restoration-polyfill/0.1.1/`. This removes the external document script request while preserving manual history-scroll restoration. The observed external requests were this parser-loaded script, not a SenseNet connectivity poll.

## Permission proof

The runtime API has no `HasPermission` dispatch. Successful caller content reads prove Open. Write preflight requires explicit non-forbidden actions, and creation checks exact effective child types. Ordinary creation uses `Add`; managed `SystemFolder` bootstrap uses the stock `StartBlobUploadToParent` operation descriptor, which proves raw AddNew even on a non-folder MediaItem where the UI `Add` action is absent. The upload operation itself is never invoked for this check. Edit/Delete retain their action proof. Multiple targets are reviewed in bounded compound descriptor queries. Missing targets/actions and any conflicting forbidden action fail closed. Whole-plan checks and repository-enforced final writes remain.

The configured read-only inventory identity proves effective See/Open/OpenMinor through one `GetAllowedUsers` operation per configured container, requiring the exact backend-verified inventory ID in the result. Its permission arguments are repeated query parameters (`permissions=See&permissions=Open&permissions=OpenMinor`), not a comma-separated string. Identity-filtered `GetPermissions` separately proves its own propagating Save/AddNew/Delete/SetPermissions denies. Group-only read grants are supported; a missing canonical read result or write-denial proof is a configuration denial. Concrete lastminor reads retain the project binding checks. This preserves the existing configured project-inventory boundary; it does not claim to repair unrelated descendant ACLs. See [SenseNet actions](https://docs.sensenet.com/api-docs/basic-concepts/09-actions/), [GetPermissions](https://docs.sensenet.com/restapi/getpermissions/) and [deny precedence](https://docs.sensenet.com/api-docs/permissions/01-permission-management/).

## More posters, same resource count

`MAX_POSTER_SOURCES` is shared across editor, generator, descriptor, manifest and API contract. The editor allows manual ordering and random selection up to twelve posters. Existing 1–4 poster atlases retain their exact pixel layout. Counts 5–12 store complete poster faces in two atlas rows, while the UI displays overlapping cards and crops the same source image for hover. No additional original requests occur when the visitor moves between cards. This does not add the deferred all-item interactive browser.

The real Chromium raster check covers counts 1, 2, 3, 4, 5, 8 and 12, 21 outputs and all 25 expanded hover targets. Stable source markers verify raster order before and after WebP encoding. Evidence is under ignored `deployment/.local/image-client-browser/`.

## Final verification on 2026-11-16

The final source passed 451 unit/contract tests, 98 parity checks, lint and a production build. The native API follow-up passed 24 real HTTPS cases and 13 whole-plan/permission preflight cases, restoring 3018 records. A separate real bootstrap regression proved that non-folder media storage can be created while Save-without-AddNew and inherited AddNew denial both stop before writes. The final effective inventory-read probe used ten GETs, zero writes and zero legacy permission requests.

The real Editor/Visitor run `4e7d4ead-f0a6-4b9e-b749-69e6b0a9a5f7` exercised twelve-poster selection, a blocked thirteenth, fresh owner revision, a repeated preview with zero new original downloads, actual publication and reopening, desktop/mobile one-atlas display, and real media-size publication. All thirteen originals retained their hashes; five generated files were independently hash-checked; cleanup restored 3018 records. Its original aggregate report remains **failed** because its final zero-external-request assertion counted the then-existing CDN document script. `feature-reconciliation.json` preserves that report and independently records ten verified feature assertions without replaying any publication or changing content. It explicitly retains the limitation that the historical external trace stored origins only.

After self-hosting the identical script, a separate read-only real Editor/Visitor login, list, SPA navigation and back-navigation probe passed with zero external requests, zero page errors and zero attempted content writes. This does not relabel the original failed aggregate run. Private evidence: `deployment/.local/multi-poster-smoke/4e7d4ead-f0a6-4b9e-b749-69e6b0a9a5f7/`, `deployment/.local/document-resources-readonly.json`, and `deployment/.local/preview-performance-2026-11-16/`. Docker source hashes and `unless-stopped` restart policy were verified. No production writes, merge or deployment were performed.

## Reproduction

Use the existing private `.env` and the local Compose app. Run content-writing suites sequentially; their setup and cleanup are limited to their own UUID fixtures.

```powershell
docker compose -f compose.local.yaml up -d --build app
npm run local:check
npm test
npm run test:parity
npm run lint
npm run build
node --dns-result-order=ipv4first tests/image-client-browser.mjs
node --dns-result-order=ipv4first scripts/m0-multi-poster-smoke.cjs
```

Manual check: Timeline → Edit → List cover → select/order more than four posters → Generate preview twice → Publish → reopen. In a Visitor window, verify the card faces and one `/images/.../wN` resource. Media → Image sizes still prepares the original's smaller sizes. See [publication verification and rollout boundaries](agent-api-cover-publication-verification.md) for the retained recovery and production limits.

## Transient gateway read recovery

The follow-up [image-read-resilience.md](image-read-resilience.md) records the
measured production HTTP520/edge-delay case and bounded read retry, source-cache
retention, explicit card retry and cancellable preview behavior.
