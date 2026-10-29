// Code-native creative layouts using unmodified iOS screen captures.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const root = __dirname;
const outputs = [
  { name: 'header', width: 3840, height: 1646 },
  { name: 'search-results', width: 3840, height: 2560 },
];
async function data(file, mime) {
  return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
}
async function main() {
  const directory = path.join(root, 'creative');
  await fs.mkdir(directory, { recursive: true });
  const [font, regular, logo, explore, rewards] = await Promise.all([
    data(path.resolve(root, '../../../website/public/fonts/sterling/FTSterlingTrial-Semi-Bold.woff'), 'font/woff'),
    data(path.resolve(root, '../../../website/public/fonts/sterling/FTSterlingTrial-Regular.woff'), 'font/woff'),
    data(path.resolve(root, '../../assets/brand/logo.svg'), 'image/svg+xml'),
    data(path.join(root, 'raw/01-explore.png'), 'image/png'),
    data(path.join(root, 'raw/06-rewards.png'), 'image/png'),
  ]);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const item of outputs) {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Akiba ${item.name}</title><style>
        @font-face{font-family:Sterling;src:url('${font}');font-weight:600}
        @font-face{font-family:Sterling;src:url('${regular}');font-weight:400}
        *{box-sizing:border-box}html,body{margin:0;width:${item.width}px;height:${item.height}px;overflow:hidden}
        body{background:#196c78;color:white;font-family:Sterling,Arial,sans-serif;position:relative}
        .brand{position:absolute;left:380px;top:300px;display:flex;align-items:center;gap:30px;font-size:72px;font-weight:600}
        .brand img{width:132px;height:132px;border:3px solid #ffffff33;border-radius:50%}
        .copy{position:absolute;left:380px;top:520px;width:1650px}
        h1{font-size:180px;line-height:1.08;letter-spacing:-5px;font-weight:600;margin:0}
        p{font-size:52px;line-height:1.45;color:#e2f6f8;margin:42px 0 0}
        .phone{position:absolute;width:590px;padding:13px;border:4px solid #555;background:#171717;border-radius:88px;box-shadow:0 35px 90px #052b3a55}
        .screen{border-radius:70px;overflow:hidden;line-height:0;background:#fcfcfc}.screen img{display:block;width:100%;height:auto}
        .explore{left:2160px;top:220px;transform:rotate(-9deg)}
        .rewards{left:2695px;top:140px;transform:rotate(8deg)}
        .search-results .brand{top:230px;left:50%;transform:translateX(-50%)}
        .search-results .copy{left:420px;right:420px;width:auto;top:480px;text-align:center}
        .search-results h1{font-size:192px;line-height:1.06}
        .search-results p{font-size:60px;margin-top:36px}
        .search-results .phone{width:600px;border-radius:94px}
        .search-results .screen{border-radius:76px}
        .search-results .explore{left:1250px;top:1140px;transform:rotate(-8deg)}
        .search-results .rewards{left:1900px;top:1060px;transform:rotate(8deg)}
      </style></head><body class="${item.name}"><div class="brand"><img src="${logo}" alt=""><span>Akiba</span></div><div class="copy"><h1>Local shopping.<br>More rewarding.</h1><p>Discover places. Earn Miles. Enjoy rewards.</p></div><div class="phone explore"><div class="screen"><img src="${explore}" alt="Akiba local discovery"></div></div><div class="phone rewards"><div class="screen"><img src="${rewards}" alt="Akiba rewards"></div></div></body></html>`;
      await fs.writeFile(path.join(directory, `${item.name}.html`), html);
      await page.setViewportSize({ width: item.width, height: item.height });
      await page.setContent(html);
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
      await sharp(await page.screenshot({ animations: 'disabled' })).flatten({ background: '#196c78' }).toColourspace('srgb').removeAlpha().png().toFile(path.join(directory, `${item.name}.png`));
      console.log(`${item.name}.png ${item.width}x${item.height}`);
    }
    const header = await sharp(path.join(directory, 'header.png')).resize({ width: 960 }).toBuffer();
    const search = await sharp(path.join(directory, 'search-results.png')).resize({ width: 960 }).toBuffer();
    await sharp({ create: { width: 992, height: 1099, channels: 3, background: '#e2e8e9' } }).composite([
      { input: header, left: 16, top: 16 }, { input: search, left: 16, top: 443 },
    ]).png().toFile(path.join(directory, 'preview.png'));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
