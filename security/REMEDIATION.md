# 2026-10-25 remediation

Original deployment: `/home/thomas/pdf2img/docker-compose.yml`, project `pdf2img`, service/container `thomas-pdf2img` on `mintage-hcp-host-1`. Image `princeamd/pdf2img:20260101@sha256:f5aca553cfc092b1792154c82004bcdaeb44611df2f010bf910fa52c276df5df`. The live `main.mjs` and lockfile SHA-256 hashes exactly matched local source commit `727e183`; this fork preserves those font and payroll changes.

## Upstream review

The publisher's only tag was `20260101`. Original upstream's latest application release/tag is [v2.0.2](https://github.com/joanfabregat/pdf2img/releases/tag/v2.0.2), published March 16, 2025. Its release notes link the v2.0.1→v2.0.2 changelog and contain no later security release. No published compatible application tag addresses the October 2026 findings; rebuilding the existing source is necessary.

Node 24.12.0→24.22.1 stays on the same runtime major. [Node's October security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) and [24.22.1 notes](https://nodejs.org/en/blog/release/v24.22.1) identify it as a security release. Alpine remains 3.23, updated to 3.23.7. Express remains 4.x. No framework/runtime major upgrade was made. The API retains PDF output, page selection, fonts and ordinary conversion defaults. Deliberate hardening changes reject unsafe/unbounded options and return 503 when the single conversion slot is busy.

## Reported RCEs

| Package / finding | Origin and remediation |
|---|---|
| libcrypto3, libssl3; CVE-2025-15467, CVE-2026-28387 | Alpine OS packages in Node/APK dependency closure; upgraded to 3.5.9-r0. Node's bundled OpenSSL is also 3.5.9. |
| glob 10.4.5, 11.0.3; CVE-2025-64756 | Two copies under the base image's global npm/node-gyp, not the application lockfile. Removed npm and Yarn from runtime. The vulnerable glob CLI shell-command feature is unused by the service. |
| zlib; CVE-2026-22184 | Alpine OS dependency; upgraded to 1.3.2-r1. The reported untgz utility is not the application's conversion path. |
| ImageMagick and codec subpackages; CVE-2026-25794 | Dockerfile apk installation and dependencies; upgraded to 7.1.2.34-r0. Image processing is reachable, so patched before deployment. Read access restricted to generated PNG; PDF output remains enabled. |
| pcre2; CVE-2026-86145 | Alpine dependency of installed conversion tooling; upgraded to 10.49-r0. |

A separate directly reachable application RCE was confirmed in a disposable, network-isolated old container: `background` could terminate a shell quote and create a harmless marker. The old process also crashed during cleanup. The new code uses shell-free subprocess argument arrays, validates fields and output formats, bounds uploads/process execution/raster dimensions, and cleans temporary files on errors/disconnections.

Full scan also identified vulnerable Multer 1 and Express transitive packages. Multer 1 has no patched release on that major. Its wrapper is removed; bounded multipart handling uses Busboy 1 (the existing underlying parser family). Express and its transitive dependencies are updated within existing major lines. No major migration of the framework is required.

## Verification

`security/scan-summary.json` records all original vulnerable packages and the complete severity comparison. Original: 62 critical, 400 high, 490 medium, 144 low, 2 unknown (package/advisory occurrences). Rebuilt image: zero findings at all severities; no ignore rules or VEX suppressions. Trivy 0.75.0, database checked October 25, 2026. Local full JSON reports are in `reports/before.json` and `reports/after.json`.

31 integration/security tests cover all output formats, full A4 with exact payroll options under 1 GiB, page selection, safe colours, injection attempts, invalid/oversized uploads, malformed/duplicate fields, interrupted uploads, concurrency limit, temporary cleanup and ImageMagick policy. Production smoke uses only a generated harmless PDF, checks both WebP and PDF output and verifies TLS.

No listed RCE remains and no known vulnerability is accepted. Continued upstream scans are required; a clean scanner result does not establish absence of unknown vulnerabilities. The service remains private to the Tailnet (Funnel disabled), without adding incompatible application authentication.

## Migration and rollback

Move the stateless service to `mintage-apps`, preserving loopback port 3000 and TSDProxy name `pdf2img`. Stop the old service and wait for its proxy node to close before transferring only `/data/default/pdf2img` from `tsdproxy_datadir`. Never run that node state on both hosts simultaneously. Other TSDProxy routes must remain running.

Private source backup retains original Compose, inspect data and stopped PDF node state. Destination receives only this node's state. On successful verification the original service is disabled and its container removed. Rollback requires stopping the destination first and confirming its PDF proxy has closed, then restoring the source Compose and starting the original service using retained state. The original image is vulnerable: prefer a forward fix, and use rollback only to recover service availability. Backup paths and deployed digest are recorded in the migration record.
