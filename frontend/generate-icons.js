const fs = require('fs');
const sharp = require('sharp');

const svgCode = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="512" height="512" rx="120" fill="url(#paint0_linear)"/>
<path d="M156 356V156H206L266 266L326 156H376V356H336V236L276 336H256L196 236V356H156Z" fill="white"/>
<defs>
<linearGradient id="paint0_linear" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
<stop stop-color="#3b82f6"/>
<stop offset="1" stop-color="#9333ea"/>
</linearGradient>
</defs>
</svg>
`;

async function generateIcons() {
  const svgBuffer = Buffer.from(svgCode);

  await sharp(svgBuffer)
    .resize(192, 192)
    .toFile('./public/icon-192x192.png');
    
  await sharp(svgBuffer)
    .resize(512, 512)
    .toFile('./public/icon-512x512.png');
    
  await sharp(svgBuffer)
    .resize(180, 180)
    .toFile('./public/apple-touch-icon.png');
    
  console.log('Icons generated successfully.');
}

generateIcons();
