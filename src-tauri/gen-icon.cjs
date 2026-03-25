const fs = require('fs');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="#0a0a0a"/>
  <g transform="translate(256,230)">
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0"/>
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0" transform="rotate(45)"/>
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0" transform="rotate(90)"/>
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0" transform="rotate(135)"/>
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0" transform="rotate(180)"/>
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0" transform="rotate(225)"/>
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0" transform="rotate(270)"/>
    <path d="M-25,-160 L25,-160 L30,-120 L-30,-120 Z" fill="#d0d0d0" transform="rotate(315)"/>
    <circle r="120" fill="#d0d0d0"/>
    <circle r="85" fill="#0a0a0a"/>
    <circle r="40" fill="#d0d0d0"/>
    <circle r="18" fill="#0a0a0a"/>
  </g>
  <text x="256" y="460" text-anchor="middle" font-family="Consolas,monospace" font-size="52" font-weight="700" fill="#888">mechanism</text>
</svg>`;
fs.writeFileSync('icon.svg', svg);
console.log('icon.svg created');
