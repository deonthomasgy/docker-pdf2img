# PDF2IMG

Maintained security build of Joan Fabrégat's MIT-licensed PDF conversion service, including the existing payroll font improvements. Source: https://github.com/deonthomasgy/docker-pdf2img. Images: `princeamd/pdf2img`.

The HTTP contract remains `GET /` for metadata and `POST /convert` with multipart `file` plus optional `format`, `density`, `page`, `width`, `height`, `quality`, and `background`. PDF output used by Mintage payroll is retained.

Supported outputs: webp (default), png, jpg/jpeg, pdf, tiff, gif. Defaults: 300 DPI, first page, 800×600 bounding box, quality 80, white background. Background accepts named or hex colours. Conversion preserves aspect ratio.

Security limits: 20 MiB uploads; one simultaneous request (additional requests return 503 with Retry-After); 55-second request deadline; 40-second subprocess limit; density 36–600, page 1–10000, dimensions 1–5000, quality 1–100. Oversized rendered pages are capped at 5000 pixels on their longest side. Invalid inputs return 400; failed conversions return 422. Temporary files are removed after responses and failures.

Node remains on 24.x and Alpine on 3.23. Express remains on 4.x. The unused npm/Yarn runtime tools and their vulnerable glob CLI copies are removed. The vulnerable Multer 1 wrapper is replaced with bounded use of the same Busboy 1 parser family, without adopting a new framework/runtime major. Poppler reads PDFs; ImageMagick can read only generated PNGs and write the allowlisted output formats. ImageMagick delegates, filters and indirect file reads are disabled. The service runs as UID 1000 with a read-only filesystem, limited temporary storage/resources and no Linux capabilities.

## Build and verify

```sh
docker build --build-arg COMMIT_SHA="$(git rev-parse HEAD)" -t pdf2img:local .
docker run --rm --memory 1g --cpus 2 --pids-limit 128 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=1g -v "$PWD/test:/app/test:ro" --entrypoint node pdf2img:local --test test/security.test.mjs
trivy image --severity CRITICAL,HIGH --exit-code 1 pdf2img:local
python3 scripts/smoke.py https://pdf2img.sphinx-butterfly.ts.net
```

Use `PDF2IMG_IMAGE` with a verified immutable digest for Compose. Do not run two TSDProxy instances with the same persisted PDF2IMG node state. Deployment and rollback evidence is recorded under `security/`; private state backups remain on the hosts, never in Git.
