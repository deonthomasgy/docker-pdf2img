#!/usr/bin/env python3
"""One benign end-to-end PDF conversion through a specified service endpoint."""
import sys, urllib.request, json
stream=b'BT /F1 12 Tf 20 100 Td (Payroll conversion smoke test) Tj ET\n'
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
pdf=b'%PDF-1.4\n';offsets=[]
for i,o in enumerate(objects,1):offsets.append(len(pdf));pdf+=str(i).encode()+b' 0 obj\n'+o+b'\nendobj\n'
xref=len(pdf);pdf+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(('%010d 00000 n \n'%o).encode() for o in offsets)+b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'
url=sys.argv[1].rstrip('/'); boundary='pdf2img-safe-smoke-boundary'
result={'url':url,'metadata':json.load(urllib.request.urlopen(url,timeout=15)),'conversions':[]}
for fmt in ['webp','pdf']:
 body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()+pdf+b'\r\n'
 for k,v in {'format':fmt,'width':800,'height':600,'background':'white','density':300}.items():body+=f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
 body+=f'--{boundary}--\r\n'.encode()
 r=urllib.request.urlopen(urllib.request.Request(url+'/convert',body,{'Content-Type':'multipart/form-data; boundary='+boundary}),timeout=60)
 data=r.read();assert data.startswith(b'%PDF-' if fmt=='pdf' else b'RIFF')
 result['conversions'].append({'format':fmt,'status':r.status,'bytes':len(data),'content_type':r.headers['Content-Type']})
print(json.dumps(result,indent=2))
