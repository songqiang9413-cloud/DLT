const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const outDir = __dirname;

function defsDark() {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05070F"/><stop offset="0.55" stop-color="#0B0A1E"/><stop offset="1" stop-color="#1A0A2A"/></linearGradient>
    <radialGradient id="glowCyan" cx="0.18" cy="0.12" r="0.65"><stop offset="0" stop-color="#00E5FF" stop-opacity="0.45"/><stop offset="1" stop-color="#00E5FF" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowPink" cx="0.88" cy="0.82" r="0.65"><stop offset="0" stop-color="#FF2D95" stop-opacity="0.42"/><stop offset="1" stop-color="#FF2D95" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowViolet" cx="0.72" cy="0.16" r="0.52"><stop offset="0" stop-color="#7C3AED" stop-opacity="0.35"/><stop offset="1" stop-color="#7C3AED" stop-opacity="0"/></radialGradient>
    <linearGradient id="dGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00F0FF"/><stop offset="0.26" stop-color="#5B8CFF"/><stop offset="0.46" stop-color="#A855F7"/><stop offset="0.63" stop-color="#FF2D95"/><stop offset="0.82" stop-color="#FF6A00"/><stop offset="1" stop-color="#FFE95C"/></linearGradient>
    <linearGradient id="stemGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00F0FF"/><stop offset="0.5" stop-color="#5B8CFF"/><stop offset="1" stop-color="#A855F7"/></linearGradient>
    <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF2D95"/><stop offset="0.42" stop-color="#FF6A00"/><stop offset="0.75" stop-color="#FFD400"/><stop offset="1" stop-color="#FFE95C"/></linearGradient>
    <linearGradient id="clockGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="#A8F7FF"/><stop offset="1" stop-color="#00E5FF"/></linearGradient>
    <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.45" stop-color="#FFE95C"/><stop offset="1" stop-color="#FF9D00"/></linearGradient>
    <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="#FFF6B0"/><stop offset="1" stop-color="#FFD400"/></linearGradient>
    <linearGradient id="borderGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00E5FF"/><stop offset="0.5" stop-color="#FF2D95"/><stop offset="1" stop-color="#FFE600"/></linearGradient>
    <filter id="softGlow" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="18" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="sparkGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="12" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
}

function darkLogo() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
${defsDark()}
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="224" fill="url(#glowCyan)"/>
  <rect width="1024" height="1024" rx="224" fill="url(#glowPink)"/>
  <rect width="1024" height="1024" rx="224" fill="url(#glowViolet)"/>
  <circle cx="512" cy="512" r="392" fill="none" stroke="url(#borderGrad)" stroke-opacity="0.18" stroke-width="2" stroke-dasharray="2 18"/>
  <rect x="22" y="22" width="980" height="980" rx="206" fill="none" stroke="url(#borderGrad)" stroke-opacity="0.38" stroke-width="3"/>
  <g opacity="0.7" filter="url(#softGlow)"><path d="M337 286 H525 A226 226 0 0 1 525 738 H337 A64 64 0 0 1 273 674 V350 A64 64 0 0 1 337 286 Z M425 350 H525 A162 162 0 0 1 525 674 H425 Q401 674 401 650 V374 Q401 350 425 350 Z" fill="url(#dGrad)" fill-rule="evenodd"/></g>   <path d="M337 286 H525 A226 226 0 0 1 525 738 H337 A64 64 0 0 1 273 674 V350 A64 64 0 0 1 337 286 Z M425 350 H525 A162 162 0 0 1 525 674 H425 Q401 674 401 650 V374 Q401 350 425 350 Z" fill="url(#dGrad)" fill-rule="evenodd"/>
  <circle cx="544" cy="512" r="92" fill="#080A16" stroke="url(#clockGrad)" stroke-width="10"/>
  <g stroke="#8FF6FF" stroke-width="5" stroke-linecap="round" opacity="0.95"><line x1="544" y1="456" x2="540" y2="470"/><line x1="544" y1="554" x2="540" y2="568"/><line x1="616" y1="512" x2="632" y2="512"/><line x1="456" y1="512" x2="472" y2="512"/></g>
  <line x1="544" y1="512" x2="540" y2="464" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
  <line x1="544" y1="512" x2="582" y2="545" stroke="#FFE95C" stroke-width="9" stroke-linecap="round"/>
  <circle cx="544" cy="512" r="13" fill="#FFE95C"/>
  <g filter="url(#sparkGlow)"><path d="M800 186 L818 232 L864 250 L818 268 L800 314 L782 268 L736 250 L782 232 Z" fill="url(#sparkGrad)"/></g>
  <path d="M902 154 L910 174 L930 182 L910 190 L902 210 L894 190 L874 182 L894 174 Z" fill="#FFE95C" opacity="0.9"/>
  <g fill="#FFFFFF" opacity="0.42"><circle cx="218" cy="792" r="6"/><circle cx="842" cy="742" r="4"/><circle cx="186" cy="706" r="3"/></g>
  <text x="512" y="906" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="96" font-weight="900" letter-spacing="18" fill="url(#textGrad)">DLT</text>
</svg>`;
}
function defsPop() {
  return `
  <defs>
    <linearGradient id="popBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00E5FF"/><stop offset="0.34" stop-color="#5B6CFF"/><stop offset="0.68" stop-color="#FF2D95"/><stop offset="1" stop-color="#FF9E00"/></linearGradient>
    <radialGradient id="popLight" cx="0.22" cy="0.12" r="0.62"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.42"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
    <radialGradient id="popDark" cx="0.88" cy="0.86" r="0.6"><stop offset="0" stop-color="#1B0033" stop-opacity="0.35"/><stop offset="1" stop-color="#1B0033" stop-opacity="0"/></radialGradient>
    <linearGradient id="whiteGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E6F8FF"/></linearGradient>
    <linearGradient id="popSpark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#FFE95C"/><stop offset="1" stop-color="#FF9D00"/></linearGradient>
    <filter id="popShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#21002F" flood-opacity="0.35"/></filter>
    <filter id="textShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#21002F" flood-opacity="0.5"/></filter>
  </defs>`;
}

function popLogo() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
${defsPop()}
  <rect width="1024" height="1024" rx="224" fill="url(#popBg)"/>
  <rect width="1024" height="1024" rx="224" fill="url(#popLight)"/>
  <rect width="1024" height="1024" rx="224" fill="url(#popDark)"/>
  <rect x="22" y="22" width="980" height="980" rx="206" fill="none" stroke="#FFFFFF" stroke-opacity="0.42" stroke-width="3"/>
  <g filter="url(#popShadow)"><path d="M337 286 H525 A226 226 0 0 1 525 738 H337 A64 64 0 0 1 273 674 V350 A64 64 0 0 1 337 286 Z M425 350 H525 A162 162 0 0 1 525 674 H425 Q401 674 401 650 V374 Q401 350 425 350 Z" fill="url(#whiteGrad)" fill-rule="evenodd"/></g>
  <circle cx="544" cy="512" r="92" fill="#081020" stroke="#FFFFFF" stroke-width="9"/>
  <g stroke="#7DF9FF" stroke-width="5" stroke-linecap="round" opacity="0.95"><line x1="544" y1="456" x2="540" y2="470"/><line x1="544" y1="554" x2="540" y2="568"/><line x1="616" y1="512" x2="632" y2="512"/><line x1="456" y1="512" x2="472" y2="512"/></g>
  <line x1="544" y1="512" x2="540" y2="464" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
  <line x1="544" y1="512" x2="582" y2="545" stroke="#FFE95C" stroke-width="9" stroke-linecap="round"/>
  <circle cx="544" cy="512" r="13" fill="#FFE95C"/>
  <g filter="url(#popShadow)"><path d="M800 186 L818 232 L864 250 L818 268 L800 314 L782 268 L736 250 L782 232 Z" fill="url(#popSpark)"/></g>
  <path d="M902 154 L910 174 L930 182 L910 190 L902 210 L894 190 L874 182 L894 174 Z" fill="#FFFFFF" opacity="0.95"/>
  <text x="512" y="906" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="96" font-weight="900" letter-spacing="18" fill="#FFFFFF" filter="url(#textShadow)">DLT</text>
</svg>`;
}
function transparentMark() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
${defsDark()}
  <g opacity="0.55" filter="url(#softGlow)"><path d="M337 286 H525 A226 226 0 0 1 525 738 H337 A64 64 0 0 1 273 674 V350 A64 64 0 0 1 337 286 Z M425 350 H525 A162 162 0 0 1 525 674 H425 Q401 674 401 650 V374 Q401 350 425 350 Z" fill="url(#dGrad)" fill-rule="evenodd"/></g>   <path d="M337 286 H525 A226 226 0 0 1 525 738 H337 A64 64 0 0 1 273 674 V350 A64 64 0 0 1 337 286 Z M425 350 H525 A162 162 0 0 1 525 674 H425 Q401 674 401 650 V374 Q401 350 425 350 Z" fill="url(#dGrad)" fill-rule="evenodd"/>
  <circle cx="544" cy="512" r="92" fill="#080A16" stroke="url(#clockGrad)" stroke-width="10"/>
  <g stroke="#8FF6FF" stroke-width="5" stroke-linecap="round" opacity="0.95"><line x1="544" y1="456" x2="540" y2="470"/><line x1="544" y1="554" x2="540" y2="568"/><line x1="616" y1="512" x2="632" y2="512"/><line x1="456" y1="512" x2="472" y2="512"/></g>
  <line x1="544" y1="512" x2="540" y2="464" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>
  <line x1="544" y1="512" x2="582" y2="545" stroke="#FFE95C" stroke-width="9" stroke-linecap="round"/>
  <circle cx="544" cy="512" r="13" fill="#FFE95C"/>
  <g filter="url(#sparkGlow)"><path d="M800 186 L818 232 L864 250 L818 268 L800 314 L782 268 L736 250 L782 232 Z" fill="url(#sparkGrad)"/></g>
</svg>`;
}

async function render(name, svg, sizes) {
  fs.writeFileSync(path.join(outDir, name + ".svg"), svg, "utf8");
  for (const size of sizes) {
    const out = path.join(outDir, name + "-" + size + ".png");
    await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(out);
    console.log(name + "-" + size + ".png", fs.statSync(out).size);
  }
}

(async () => {
  await render("dlt-logo-neon", darkLogo(), [1024, 512, 256]);
  await render("dlt-logo-pop", popLogo(), [1024, 512, 256]);
  await render("dlt-mark-transparent", transparentMark(), [1024, 512, 256]);
})().catch((e) => { console.error(e); process.exit(1); });
