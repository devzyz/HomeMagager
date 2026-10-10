"""Generate real small receipt files locally for network upload/download tests."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[2] / 'artifacts/autodl/test-fixtures'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (240, 120), 'white')
draw = ImageDraw.Draw(image)
draw.rectangle((5, 5, 234, 114), outline='navy', width=2)
draw.text((15, 20), 'HomeManager real network test', fill='black')
draw.text((15, 55), 'Receipt: CNY 128.50', fill='black')
for extension, kind in [('png','PNG'), ('jpg','JPEG'), ('webp','WEBP')]:
    image.save(root / ('receipt.' + extension), kind)
stream = b'BT /F1 14 Tf 30 100 Td (HomeManager network receipt: CNY 128.50) Tj ET'
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
pdf = b'%PDF-1.4\n'
offsets = [0]
for i, data in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf += str(i).encode() + b' 0 obj\n' + data + b'\nendobj\n'
xref = len(pdf)
pdf += b'xref\n0 6\n0000000000 65535 f \n'
for offset in offsets[1:]:
    pdf += f'{offset:010d} 00000 n \n'.encode()
pdf += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'
(root / 'receipt.pdf').write_bytes(pdf)
print('Generated valid PNG/JPEG/WEBP/PDF fixtures on the local machine')