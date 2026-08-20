// assets/generate_icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, drawFn) {
  // RGBA buffer
  const buffer = Buffer.alloc(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  // PNG Filter Type 0 (None) for each scanline
  const scanlineSize = width * 4 + 1;
  const filteredData = Buffer.alloc(height * scanlineSize);
  for (let y = 0; y < height; y++) {
    filteredData[y * scanlineSize] = 0; // Filter None
    buffer.copy(filteredData, y * scanlineSize + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(filteredData);

  function crc32(buf) {
    let table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const combined = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Draw icon: Glowing rounded square with "H" / Speed Pruner bolt motif
function drawHPrunerIcon(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;
  const cx = 0.5;
  const cy = 0.5;

  // Rounded rectangle distance
  const cornerRadius = 0.22;
  const dx = Math.max(Math.abs(nx - cx) - (0.44 - cornerRadius), 0);
  const dy = Math.max(Math.abs(ny - cy) - (0.44 - cornerRadius), 0);
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > cornerRadius + 0.02) {
    return [0, 0, 0, 0]; // Transparent outside
  }

  // Smooth anti-aliased border
  let alpha = 255;
  if (dist > cornerRadius - 0.02) {
    const t = (dist - (cornerRadius - 0.02)) / 0.04;
    alpha = Math.max(0, Math.min(255, Math.floor((1 - t) * 255)));
  }

  // Gradient background: Deep Cyan / Emerald (#091e24 -> #0f4c5c -> #10b981)
  const grad = nx * 0.4 + ny * 0.6;
  let bgR = Math.floor(10 + grad * 15);
  let bgG = Math.floor(25 + grad * 60);
  let bgB = Math.floor(40 + grad * 80);

  const px = nx;
  const py = ny;

  // Let's create an "H" shape with a glowing slash (pruner)
  // Left bar: x in [0.22, 0.36], y in [0.24, 0.76]
  // Right bar: x in [0.64, 0.78], y in [0.24, 0.76]
  // Center crossbar: x in [0.34, 0.66], y in [0.44, 0.56]
  const inLeftBar = (px >= 0.22 && px <= 0.36 && py >= 0.22 && py <= 0.78);
  const inRightBar = (px >= 0.64 && px <= 0.78 && py >= 0.22 && py <= 0.78);
  const inCrossBar = (px >= 0.34 && px <= 0.66 && py >= 0.44 && py <= 0.56);

  if (inLeftBar || inRightBar || inCrossBar) {
    // Glowing Emerald / Cyan gradient
    const glyphGrad = (px + py) * 0.5;
    const gR = Math.floor(16 + glyphGrad * 40);
    const gG = Math.floor(210 + glyphGrad * 45);
    const gB = Math.floor(180 + glyphGrad * 75);
    return [gR, gG, gB, alpha];
  }

  // Inner subtle glow/border
  if (dist > cornerRadius - 0.05) {
    return [Math.floor(bgR + 40), Math.floor(bgG + 80), Math.floor(bgB + 90), alpha];
  }

  return [bgR, bgG, bgB, alpha];
}

const sizes = [16, 48, 128];
sizes.forEach(size => {
  const pngData = createPNG(size, size, drawHPrunerIcon);
  const filePath = path.join(__dirname, `icon${size}.png`);
  fs.writeFileSync(filePath, pngData);
  console.log(`Generated ${filePath} (${size}x${size})`);
});
