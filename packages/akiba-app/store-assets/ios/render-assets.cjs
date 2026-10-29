// Render local HTML artwork; original app captures are embedded unchanged.
// NODE_PATH must include playwright and sharp (available in the Codex runtime).
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const root = __dirname;
const width = 1206;
const height = 2622;
const cards = [
  { name: '01-discover', image: '01-explore.png', title: 'Find your next<br>local favourite.', subtitle: 'Discover places worth a visit.', tone: 'light' },
  { name: '02-earn-miles', image: '09-profile-activity.png', title: 'Everyday shopping.<br>Extra rewarding.', subtitle: 'Earn Miles at participating stores.', tone: 'teal' },
  { name: '03-rewards', image: '06-rewards.png', title: 'Your Miles.<br>Your next reward.', subtitle: 'Explore vouchers and free offers.', tone: 'light' },
  { name: '04-offers', image: '05-offers.png', title: 'A good offer.<br>A great discovery.', subtitle: 'Swipe through local merchant offers.', tone: 'teal' },
  { name: '05-verified-visits', image: '10-verified-visits.png', title: 'Real visits.<br>Local favourites.', subtitle: 'See what the community loved.', tone: 'light' },
];

async function dataUrl(file, mime) {
  return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
}

async function main() {
  await fs.mkdir(path.join(root, 'exports'), { recursive: true });
  await fs.mkdir(path.join(root, 'layouts'), { recursive: true });
  const font = await dataUrl(path.resolve(root, '../../../website/public/fonts/sterling/FTSterlingTrial-Semi-Bold.woff'), 'font/woff');
  const regular = await dataUrl(path.resolve(root, '../../../website/public/fonts/sterling/FTSterlingTrial-Regular.woff'), 'font/woff');
  const logo = await dataUrl(path.resolve(root, '../../assets/brand/logo.svg'), 'image/svg+xml');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    for (const card of cards) {
      const image = await dataUrl(path.join(root, 'raw', card.image), 'image/png');
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Akiba — ${card.name}</title><style>
        @font-face{font-family:Sterling;src:url('${font}');font-weight:600}
        @font-face{font-family:Sterling;src:url('${regular}');font-weight:400}
        *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
        body{background:#f3fcfd;color:#0d0e0c;font-family:Sterling,Arial,sans-serif}
        body.teal{background:#196c78;color:#fff}
        .brand{position:absolute;left:86px;top:80px;display:flex;align-items:center;gap:24px;font-size:42px;font-weight:600}
        .brand img{width:88px;height:88px}.teal .brand img{border:3px solid #ffffff38;border-radius:50%}
        .copy{position:absolute;left:86px;right:70px;top:235px}
        h1{font-size:104px;line-height:1.08;letter-spacing:-3px;font-weight:600;margin:0}
        p{font-size:38px;line-height:1.35;letter-spacing:-.3px;font-weight:400;margin:30px 0 0;color:#40585b}
        .teal p{color:#e2f6f8}
        .phone{position:absolute;top:640px;left:153px;width:900px;padding:15px;background:#191919;border:4px solid #474747;border-radius:120px;box-shadow:0 30px 70px #10292d24}
        .screen{border-radius:100px;overflow:hidden;background:#fcfcfc;line-height:0}
        .screen img{width:100%;height:auto;display:block}
      </style></head><body class="${card.tone}"><div class="brand"><img src="${logo}" alt=""><span>Akiba</span></div><div class="copy"><h1>${card.title}</h1><p>${card.subtitle}</p></div><div class="phone"><div class="screen"><img src="${image}" alt="Akiba app screen"></div></div></body></html>`;
      await fs.writeFile(path.join(root, 'layouts', `${card.name}.html`), html);
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.screen img').evaluate(img => img.decode());
      const capture = await page.screenshot({ animations: 'disabled' });
      const output = path.join(root, 'exports', `${card.name}.png`);
      await sharp(capture).flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha().png().toFile(output);
      console.log(`${card.name}.png ${width}x${height}`);
    }
    const thumbs = await Promise.all(cards.map(async (card, index) => ({
      input: await sharp(path.join(root, 'exports', `${card.name}.png`)).resize({ width: 240 }).toBuffer(),
      left: index * 256 + 16,
      top: 16,
    })));
    await sharp({ create: { width: 1296, height: 554, channels: 3, background: '#e2e8e9' } }).composite(thumbs).png().toFile(path.join(root, 'preview.png'));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
