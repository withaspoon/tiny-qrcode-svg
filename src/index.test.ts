import makeSvg from "../src/index.ts";
import jsQR from "jsqr";
import sharp from "sharp";

import { expect, test } from "vitest";

async function scanCode(svg: string) {
  const { data, info } = await sharp(Buffer.from(svg))
    .flatten({
      background: { r: 255, g: 255, b: 255 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const code = jsQR(
    new Uint8ClampedArray(data.buffer),
    info.width,
    info.height
  );

  return code?.data;
}

test("should make a scannable svg", async () => {
  const svg = makeSvg("hello world");
  expect(await scanCode(svg)).toBe("hello world");
});

test("should handle emojis", async () => {
  const svg = makeSvg("👋🌍");
  expect(await scanCode(svg)).toBe("👋🌍");
});

test("should handle empty strings", async () => {
  const svg = makeSvg("");
  expect(await scanCode(svg)).toBe("");
});
