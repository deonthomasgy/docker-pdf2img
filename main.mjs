/* Copyright (c) 2025 Joan Fabrégat <j@fabreg.at>. MIT; see LICENSE. */
import express from 'express';
import busboy from 'busboy';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

const execute = promisify(execFile);
const formats = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf', 'tiff', 'gif']);
const MAX_FILE = 20 * 1024 * 1024;
class InputError extends Error {}
export function options(body) {
    const number = (key, fallback, min, max) => {
        const value = body[key] ?? String(fallback);
        if (typeof value !== 'string' || !/^\d+$/.test(value) || +value < min || +value > max)
            throw new InputError(`Invalid ${key}`);
        return +value;
    };
    const format = body.format ?? 'webp';
    const background = body.background ?? 'white';
    if (!formats.has(format)) throw new InputError('Unsupported format');
    // Named colours and hex colours only; no filenames, expressions, or shell syntax.
    if (typeof background !== 'string' || !/^(?:[a-zA-Z]{1,24}|#[0-9a-fA-F]{3,8})$/.test(background))
        throw new InputError('Invalid background');
    return {format, background, density: number('density', 300, 36, 600),
        page: number('page', 1, 1, 10000), width: number('width', 800, 1, 5000),
        height: number('height', 600, 1, 5000), quality: number('quality', 80, 1, 100)};
}

function multipart(req, signal) {
    return new Promise((resolve, reject) => {
        let parser;
        try { parser = busboy({headers: req.headers, limits: {
            fileSize: MAX_FILE, files: 1, fields: 8, parts: 9, fieldSize: 128, fieldNameSize: 32
        }}); } catch { reject(new InputError('Expected multipart upload')); return; }
        const fields = Object.create(null), chunks = [];
        let fileSeen = false, failure;
        const fail = message => { failure ??= new InputError(message); };
        const cancel = () => parser.destroy(new InputError('Upload interrupted'));
        signal.addEventListener('abort', cancel, {once: true});
        parser.on('file', (name, stream) => {
            if (name !== 'file' || fileSeen) fail('Expected one file');
            fileSeen = true;
            stream.on('limit', () => fail('File exceeds 20 MiB'));
            stream.on('error', error => { failure ??= error; });
            stream.on('data', chunk => { if (!failure) chunks.push(chunk); });
        });
        parser.on('field', (name, value, info) => {
            if (info.nameTruncated || info.valueTruncated || Object.hasOwn(fields, name)) fail('Invalid field');
            fields[name] = value;
        });
        for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) parser.on(event, () => fail('Too many fields or files'));
        parser.on('error', () => reject(new InputError('Malformed or interrupted upload')));
        parser.on('close', () => {
            signal.removeEventListener('abort', cancel);
            req.unpipe(parser);
            if (!req.complete) req.resume();
            if (failure) return reject(failure);
            const file = Buffer.concat(chunks);
            if (!fileSeen || !file.length) return reject(new InputError('No file uploaded'));
            if (!file.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return reject(new InputError('Expected a PDF file'));
            resolve({fields, file});
        });
        req.pipe(parser);
    });
}

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    const upSince = new Date().toISOString();
    let active = 0;
    app.get('/', (_req, res) => res.json({upSince, version: process.env.VERSION ?? null,
        buildId: process.env.BUILD_ID ?? null, commitSha: process.env.COMMIT_SHA ?? null}));
    app.post('/convert', async (req, res) => {
        if (active >= 1) return res.status(503).set('Retry-After', '5').json({error: 'Converter busy'});
        active++;
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 55000);
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        req.once('aborted', disconnected);
        res.once('close', disconnected);
        let directory;
        try {
            const {fields, file} = await multipart(req, controller.signal);
            const o = options(fields);
            directory = await mkdtemp(join(tmpdir(), 'pdf2img-'));
            const pdf = join(directory, 'input.pdf'), prefix = join(directory, 'render');
            const output = join(directory, `output.${o.format}`);
            await writeFile(pdf, file, {mode: 0o600});
            const limits = {timeout: 40000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, signal: controller.signal};
            // Measure the selected page before rasterization; preserve DPI for ordinary pages.
            const {stdout} = await execute('pdfinfo', ['-f', String(o.page), '-l', String(o.page), pdf], limits);
            const size = stdout.match(/(?:Page\s+\d+\s+size|Page size):\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/);
            if (!size || !Number.isFinite(+size[1]) || !Number.isFinite(+size[2])) throw new InputError('Invalid PDF page');
            const bound = Math.max(+size[1], +size[2]) * o.density / 72 > 5000 ? ['-scale-to', '5000'] : [];
            // Never invoke a shell. Only oversized pages have their raster resolution capped.
            await execute('pdftocairo', ['-png', '-r', String(o.density), ...bound,
                '-f', String(o.page), '-l', String(o.page), '-singlefile', pdf, prefix], limits);
            await execute('magick', [`png:${prefix}.png`, '-background', o.background,
                '-flatten', '-resize', `${o.width}x${o.height}`, '-quality', String(o.quality),
                `${o.format}:${output}`], limits);
            await new Promise((resolve, reject) => res.sendFile(output, error => error ? reject(error) : resolve()));
        } catch (error) {
            if (!res.headersSent && !res.destroyed) res.status(error instanceof InputError ? 400 : 422)
                .json({error: error instanceof InputError ? error.message : 'Unable to convert PDF within service limits'});
        } finally {
            clearTimeout(deadline);
            req.removeListener('aborted', disconnected);
            res.removeListener('close', disconnected);
            active--;
            if (directory) await rm(directory, {recursive: true, force: true});
        }
    });
    return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
    server.requestTimeout = 60000;
    server.headersTimeout = 15000;
}
