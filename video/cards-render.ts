/**
 * Render the intro and outro cards frame by frame at exactly 30 fps, by
 * pausing every CSS animation and stepping its clock. Writes the same
 * frames.json layout the recorder does, so compose.py treats them alike.
 *
 *   FEN_CHROME=<chrome.exe> npx tsx video/cards-render.ts
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const FPS = 30;
const vo = (id: string) => JSON.parse(readFileSync(`video/build/vo/${id}.json`, "utf8")).duration as number;

const browser = await chromium.launch({ executablePath: process.env.FEN_CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });

for (const kind of ["intro", "outro"] as const) {
  const total = vo(kind) + (kind === "intro" ? 0.6 : 0.9) + 0.8;
  const leaveAt = total - 0.8;
  const dir = path.resolve("video/build/frames", kind);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.goto("file:///" + path.resolve("video/cards.html").replace(/\\/g, "/") + `?kind=${kind}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const frames: { file: string; t: number }[] = [];
  let left = false;
  const n = Math.round(total * FPS);
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    if (!left && t >= leaveAt) {
      await page.evaluate(() => (window as unknown as { leave(): void }).leave());
      left = true;
    }
    await page.evaluate(
      ({ t, leaveAt }) => {
        for (const a of document.getAnimations()) {
          const name = (a as CSSAnimation).animationName;
          a.pause();
          a.currentTime = name === "outAll" ? Math.max(0, (t - leaveAt) * 1000) : t * 1000;
        }
      },
      { t, leaveAt },
    );
    const file = `${String(i).padStart(5, "0")}.jpg`;
    await page.screenshot({ path: path.join(dir, file), type: "jpeg", quality: 94 });
    frames.push({ file, t });
  }
  writeFileSync(path.join(dir, "frames.json"), JSON.stringify({ t0: 0, end: total, frames, cuts: [], marks: { go: 0 } }, null, 1));
  console.log(`${kind}: ${frames.length} frames, ${total.toFixed(2)}s`);
}
await browser.close();
