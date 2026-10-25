import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {createApp, options} from '../main.mjs';

function pdf(a4 = false) {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
        null, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>', null,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    for (const [i, text] of [[3, 'Payroll test page one'], [5, 'Payroll test page two']]) {
        const stream = `BT /F1 10 Tf 10 40 Td (${text}) Tj ET\n`;
        objects[i] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    }
    if (a4) objects[2] = objects[2].replace('[0 0 200 100]', '[0 0 595 842]');
    let result = '%PDF-1.4\n', offsets = [0];
    objects.forEach((o,i) => { offsets.push(Buffer.byteLength(result)); result += `${i+1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(result);
    result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    result += offsets.slice(1).map(o => `${String(o).padStart(10,'0')} 00000 n \n`).join('');
    result += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(result);
}
const app = createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const root = `http://127.0.0.1:${server.address().port}`;
async function convert(fields = {}, file = pdf()) {
    const form = new FormData();
    if (file) form.append('file', new Blob([file], {type:'application/pdf'}), 'test.pdf');
    for (const [k,v] of Object.entries(fields)) form.append(k, String(v));
    const response = await fetch(root + '/convert', {method:'POST', body:form});
    return {status:response.status, type:response.headers.get('content-type'), body:Buffer.from(await response.arrayBuffer())};
}
test.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
test('metadata endpoint', async () => assert.equal((await fetch(root)).status, 200));
for (const [format, magic] of [['png','89504e47'], ['jpg','ffd8'], ['webp','52494646'], ['pdf','25504446'], ['tiff','4949'], ['gif','47494638']]) {
    test(`converts valid PDF to ${format}`, async () => {
        const r = await convert({format, density:72, width:200, height:200});
        assert.equal(r.status,200,r.body.toString());
        assert.equal(r.body.subarray(0,magic.length/2).toString('hex'),magic);
    });
}
test('page selection and resizing', async () => {
    const r = await convert({format:'png',page:2,width:100,height:200});
    assert.equal(r.status,200,r.body.toString());
    assert.equal(r.body.readUInt32BE(16),100); assert.equal(r.body.readUInt32BE(20),200);
});
test('payroll PDF output options remain supported', async () => {
    const r = await convert({format:'pdf',density:400,quality:95,width:3508,height:4961,page:1,background:'white'}, pdf(true));
    assert.equal(r.status,200,r.body.toString()); assert.equal(r.body.subarray(0,5).toString(),'%PDF-');
});
for (const fields of [
    {format:'png;touch /tmp/pdf2img-pwned'}, {format:'../../tmp/escape'}, {format:'https'}, {format:'mvg'},
    {background:"white';touch /tmp/pdf2img-pwned;'"}, {background:'@/etc/passwd'},
    {width:0}, {height:5001}, {density:601}, {density:'NaN'}, {page:-1}, {quality:101}
]) test(`rejects invalid options ${JSON.stringify(fields)}`, async () => assert.equal((await convert(fields)).status,400));
test('accepts safe hex colour', async () => assert.equal((await convert({background:'#ffffff',format:'png',width:100,height:100})).status,200));
test('missing upload', async () => assert.equal((await convert({},null)).status,400));
test('non-PDF upload', async () => assert.equal((await convert({},Buffer.from('not a PDF'))).status,400));
test('damaged PDF fails safely', async () => assert.equal((await convert({},Buffer.from('%PDF-1.4\nbroken'))).status,422));
test('upload limit enforced', async () => assert.equal((await convert({},Buffer.alloc(21*1024*1024,32))).status,400));
test('malformed multipart rejected', async () => {
    const r = await fetch(root+'/convert',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=test'},body:'--test\r\nbroken'});
    assert.equal(r.status,400);
});
test('duplicate option rejected', async () => {
    const f=new FormData(); f.append('file',new Blob([pdf()]),'test.pdf');f.append('format','png');f.append('format','pdf');
    assert.equal((await fetch(root+'/convert',{method:'POST',body:f})).status,400);
});
test('bounded concurrent uploads and aborted request cleanup', async () => {
    const pending = [];
    for (let i=0;i<1;i++) {
        const r=http.request(root+'/convert',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=pending'}});
        r.on('error',()=>{});
        r.write('--pending\r\nContent-Disposition: form-data; name="file"; filename="incomplete.pdf"\r\n\r\n%PDF-');
        pending.push(r);
    }
    await new Promise(r=>setTimeout(r,50));
    try { assert.equal((await convert()).status,503); }
    finally { for(const r of pending) r.destroy(); }
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await convert({format:'png'})).status,200);
});
test('ImageMagick denies dangerous input coders and indirect reads', () => {
    for(const input of ['https://example.com/x.png','label:@/etc/passwd','pdf:/etc/passwd','mvg:/etc/passwd'])
        assert.throws(()=>execFileSync('magick',[input,'png:/tmp/denied.png'],{stdio:'pipe'}));
});
test('no shell injection artifact or temporary conversion files remain', async () => {
    await new Promise(r=>setTimeout(r,100));
    const files=await readdir('/tmp');
    assert.ok(!files.includes('pdf2img-pwned'));
    assert.deepEqual(files.filter(n=>n.startsWith('pdf2img-')),[]);
});
