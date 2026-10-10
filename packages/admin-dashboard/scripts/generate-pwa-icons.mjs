// Rasterizes public/svg/minimiles-symbol.svg into the PWA icon set (spec
// §11.1). Runs entirely offline — no external service — and is only
// re-run by hand if the source brand mark changes; output is committed as
// static files under public/icons/.
//
// Maskable safe zone: Android applies a circular mask that can crop up to
// ~20% from each edge, so the mark is scaled to fit inside the inner ~60%
// of the maskable canvas, padded with the mark's own circle color so the
// full-bleed background reads as a continuation of the brand circle rather
// than an unrelated color block.

import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(root, "..");
const svgPath = path.join(pkgRoot, "public/svg/minimiles-symbol.svg");
const outDir = path.join(pkgRoot, "public/icons");

const BRAND_CIRCLE_COLOR = "#238D9D";

async function main() {
  await mkdir(outDir, { recursive: true });
  const svg = await readFile(svgPath);

  await sharp(svg).resize(192, 192).png().toFile(path.join(outDir, "icon-192.png"));
  await sharp(svg).resize(512, 512).png().toFile(path.join(outDir, "icon-512.png"));
  await sharp(svg).resize(180, 180).png().toFile(path.join(outDir, "apple-touch-icon.png"));

  // Maskable 512x512: mark scaled to ~60% of the canvas, centered on a
  // solid background matching the mark's own circle color.
  const markSize = Math.round(512 * 0.6);
  const markBuffer = await sharp(svg).resize(markSize, markSize).png().toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: BRAND_CIRCLE_COLOR,
    },
  })
    .composite([{ input: markBuffer, gravity: "center" }])
    .png()
    .toFile(path.join(outDir, "icon-512-maskable.png"));

  console.log("Generated PWA icons in public/icons/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
