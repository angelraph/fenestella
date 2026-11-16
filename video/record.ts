/**
 * Record the demo, scene by scene, from the live site.
 *
 *   FEN_CHROME=<chrome.exe> npx tsx video/record.ts <account-name> [scene ...]
 *
 * <account-name> is a throwaway testnet account in .keys/<name>.mnemonic that
 * has never linked the agent (scripts/demo-account.ts makes one). Each scene
 * is captured with Chrome's screencast at 1920x1080 into
 * video/build/frames/<scene>/, with frame timestamps and the spans where the
 * page only waits for the chain ("cuts"), which the editor removes.
 */
import { chromium, type Locator, type Page } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deriveUnifiedAccount } from "@qorechain/sdk";
import deployments from "../deployments.testnet.json";

const SITE = process.env.FEN_SITE ?? "https://fenestella.vercel.app";
const accountName = process.argv[2] ?? "demo";
const only = new Set(process.argv.slice(3));
const mnemonic = readFileSync(`.keys/${accountName}.mnemonic`, "utf8").trim();
const BILLS = deployments.contracts.Bills.address;
const OUT = path.resolve("video/build/frames");
const vo = (id: string) => JSON.parse(readFileSync(`video/build/vo/${id}.json`, "utf8")).duration as number;

const now = () => Date.now() / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A visible cursor and click ripple, since headless capture has none. Also hides the phrase field. */
const OVERLAY = `
(() => {
  const css = \`
    #__cur { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 26px; height: 26px; pointer-events: none;
      transform: translate(-100px,-100px); transition: none; filter: drop-shadow(0 2px 6px rgba(0,0,0,.6)); }
    .__rip { position: fixed; z-index: 2147483646; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 2px solid #6fcfae; pointer-events: none; animation: __rip .6s ease-out forwards; }
    @keyframes __rip { to { transform: scale(4.2); opacity: 0; } }
    #dash-phrase { -webkit-text-security: disc !important; }
    nextjs-portal { display: none !important; }
  \`;
  const add = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.5 20.6 L12.2 14.2 L19 14 Z" fill="#f3eee2" stroke="#060707" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const p = window.__curPos || [720, 405];
    c.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)';
  };
  document.addEventListener('mousemove', (e) => {
    window.__curPos = [e.clientX, e.clientY];
    const c = document.getElementById('__cur'); if (c) c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
  }, true);
  document.addEventListener('mousedown', (e) => {
    const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 700);
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: false });
})();`;

class Recorder {
  frames: { file: string; t: number }[] = [];
  cuts: [number, number][] = [];
  marks: Record<string, number> = {};
  dir = "";
  scene = "";
  t0 = 0;
  constructor(private cdp: Awaited<ReturnType<Page["context"]>>["newCDPSession"] extends (...a: never[]) => Promise<infer S> ? S : never) {
    this.cdp.on("Page.screencastFrame", async (f) => {
      if (this.scene) {
        const file = path.join(this.dir, `${String(this.frames.length).padStart(5, "0")}.jpg`);
        writeFileSync(file, Buffer.from(f.data, "base64"));
        this.frames.push({ file: path.basename(file), t: f.metadata.timestamp ?? now() });
      }
      await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
  }
  async start(scene: string) {
    this.scene = scene;
    this.dir = path.join(OUT, scene);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.cuts = [];
    this.marks = {};
    this.t0 = now();
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  }
  mark(name: string) {
    this.marks[name] = now() - this.t0;
  }
  /** Run `fn` (a wait for the chain); keep `keepHead`/`keepTail` seconds of it, cut the rest. */
  async waiting<T>(fn: () => Promise<T>, keepHead = 1.1, keepTail = 0.5): Promise<T> {
    const a = now();
    const v = await fn();
    const b = now();
    if (b - a > keepHead + keepTail + 0.6) this.cuts.push([a + keepHead - this.t0, b - keepTail - this.t0]);
    return v;
  }
  async stop() {
    await sleep(250);
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    const end = now() - this.t0;
    writeFileSync(
      path.join(this.dir, "frames.json"),
      JSON.stringify({ t0: this.t0, end, frames: this.frames.map((f) => ({ file: f.file, t: f.t - this.t0 })), cuts: this.cuts, marks: this.marks }, null, 1),
    );
    console.log(`  ${this.scene}: ${this.frames.length} frames, ${end.toFixed(1)}s recorded, ${this.cuts.reduce((s, c) => s + c[1] - c[0], 0).toFixed(1)}s cut`);
    this.scene = "";
  }
}

async function main() {
  const exts = ["qorex", "keplr", "metamask", "okx"].map((n) => path.resolve("video/build/ext", n));
  rmSync(path.resolve("video/build/profile"), { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(path.resolve("video/build/profile"), {
    executablePath: process.env.FEN_CHROME,
    headless: true,
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 4 / 3,
    args: [`--disable-extensions-except=${exts.join(",")}`, `--load-extension=${exts.join(",")}`, "--hide-scrollbars"],
  });
  await ctx.addInitScript(OVERLAY);
  await sleep(4000);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  ctx.on("page", (p) => {
    if (p !== page) void p.close().catch(() => {});
  });
  page.setDefaultTimeout(90_000);
  const rec = new Recorder(await ctx.newCDPSession(page));
  const acct = await deriveUnifiedAccount(mnemonic);
  console.log(`Recording as ${acct.cosmos}`);

  const mouse = { x: 720, y: 405 };
  const moveTo = async (x: number, y: number, ms = 650) => {
    // Time-based easing: each step lands where the curve says it should be by now.
    const sx = mouse.x, sy = mouse.y;
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      if (k >= 1) break;
      await sleep(8);
    }
    mouse.x = x;
    mouse.y = y;
  };
  const center = async (l: Locator) => {
    await l.scrollIntoViewIfNeeded();
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const hover = async (l: Locator, ms = 650) => {
    const c = await center(l);
    await moveTo(c.x, c.y, ms);
  };
  const click = async (l: Locator, ms = 650) => {
    await hover(l, ms);
    await sleep(180);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
    await sleep(250);
  };
  const type = async (text: string, delay = 38) => {
    await page.keyboard.type(text, { delay });
  };
  const scrollTo = async (target: Locator | number, ms = 1100, offset = 90) => {
    const y =
      typeof target === "number"
        ? target
        : await target.evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY - off, offset);
    await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
    await sleep(ms);
  };
  const hold = (s: number) => sleep(s * 1000);
  const scene = async (id: string, fn: () => Promise<void>) => {
    if (only.size && !only.has(id)) return false;
    await rec.start(id);
    try {
      await fn();
    } finally {
      await rec.stop();
    }
    return true;
  };
  const cards = (kind: string) => "file:///" + path.resolve("video/cards.html").replace(/\\/g, "/") + `?kind=${kind}`;

  await scene("intro", async () => {
    await page.goto(cards("intro"), { waitUntil: "networkidle" });
    rec.mark("go");
    await hold(vo("intro") + 0.6);
    await page.evaluate(() => (window as unknown as { leave(): void }).leave());
    await hold(0.8);
  });

  await page.goto(SITE + "/", { waitUntil: "networkidle" });
  await moveTo(720, 300, 10);

  await scene("landing", async () => {
    await hold(0.8);
    await hover(page.locator("h1").first(), 900);
    await hold(1.6);
    await hover(page.locator(".lookup-card input").first(), 800);
    await hold(1.4);
    await hover(page.locator(".lookup-card .seg").first(), 600);
    await hold(1.0);
    await scrollTo(page.locator("#states-h"), 1400, 70);
    for (const lvl of ["sealed", "scoped", "open", "takeover"]) {
      await hover(page.locator(`.screen[data-level="${lvl}"]`), 700);
      await hold(lvl === "takeover" ? 3.4 : 1.25);
    }
    await scrollTo(0, 1200);
  });

  await scene("account", async () => {
    await click(page.locator(".lookup-card input").first());
    await type(acct.cosmos, 22);
    await hold(0.3);
    await click(page.getByRole("button", { name: "Read account" }));
    await rec.waiting(() => page.locator(".exposure .headline").waitFor(), 0.8, 0.2);
    await hold(0.6);
    await hover(page.locator(".exposure .headline"), 800);
    await hold(4.2);
    await scrollTo(page.locator(".facts"), 1200, 120);
    await hover(page.locator(".fact").nth(0), 600);
    await hold(1.8);
    await hover(page.locator(".fact").nth(1), 600);
    await hold(1.0);
    await hover(page.locator(".fact").nth(2), 600);
    await hold(1.0);
    await hover(page.locator(".fact").nth(5), 600);
    await hold(1.6);
  });

  await scene("connect", async () => {
    await scrollTo(0, 900);
    await click(page.locator(".header-right button").filter({ hasText: "Connect wallet" }));
    await page.locator(".wallet-row").first().waitFor();
    await hold(2.0);
    for (const n of [0, 1, 2]) {
      const row = page.locator(".wallet-list .wallet-row").nth(n);
      if (await row.count()) {
        await hover(row, 450);
        await hold(0.5);
      }
    }
    const dash = page.locator(".wallet-row", { hasText: "QoreChain Dashboard wallet" });
    await click(dash);
    await hold(0.6);
    await click(page.locator("#dash-addr"));
    await type(acct.cosmos, 14);
    await click(page.locator("#dash-phrase"), 500);
    await page.locator("#dash-phrase").fill(mnemonic);
    await hold(0.8);
    await click(page.getByRole("button", { name: "Check and connect" }));
    await rec.waiting(() => page.locator(".header-right .chip .mono").waitFor(), 0.8, 0.3);
    await hold(1.6);
  });

  await scene("window", async () => {
    await scrollTo(page.locator("#window-h"), 1200, 90);
    await click(page.locator(".preset", { hasText: "One contract" }));
    await click(page.locator("#w-targets"));
    await type(BILLS, 16);
    await hold(0.6);
    await hover(page.locator(".summary").first(), 700);
    await hold(2.2);
    await click(page.getByRole("button", { name: /^(Open|Replace) window$/ }));
    await rec.waiting(() => page.locator(".notice.ok", { hasText: "Open window: done" }).waitFor(), 1.2, 0.4);
    await hold(0.8);
    await scrollTo(page.locator(".exposure"), 1100, 110);
    await hover(page.locator(".exposure .headline"), 700);
    await hold(3.4);
    await scrollTo(page.locator("#window-h"), 1000, 90);
    await click(page.getByRole("button", { name: "Close the open window now" }));
    await rec.waiting(() => page.locator(".notice.ok", { hasText: "Close window: done" }).waitFor(), 1.0, 0.3);
    await scrollTo(page.locator(".exposure"), 1000, 110);
    await hold(1.6);
  });

  // The agent page: 0 link, 1 bill, 2 the AI, 3 the mandate, 4 the stolen key.
  const step = (n: number) => page.locator(".agent-step").nth(n);

  await scene("agent", async () => {
    await scrollTo(0, 700);
    await click(page.locator(".site-nav a", { hasText: "Agent" }));
    await page.getByRole("button", { name: "Link the agent" }).waitFor();
    await hold(1.4);
    await scrollTo(step(0), 900, 90);
    await hover(step(0).locator(".summary"), 700);
    await hold(2.2);
    await click(page.getByRole("button", { name: "Link the agent" }));
    await rec.waiting(() => step(0).locator(".pill.active").waitFor(), 1.0, 0.3);
    await hover(step(0).locator(".summary"), 600);
    await hold(2.0);
    await scrollTo(step(1), 900, 90);
    await click(page.getByRole("button", { name: /Ask the vendor/ }));
    await rec.waiting(() => page.locator(".bill-list li").first().waitFor(), 1.0, 0.3);
    await hold(1.4);
  });

  await scene("ai", async () => {
    await scrollTo(step(2), 1000, 90);
    const sample = (name: string) => step(2).getByRole("button", { name });
    await sample("Phishing: new address, urgent").waitFor();
    await click(sample("Phishing: new address, urgent"));
    await hold(1.2);
    await hover(step(2).locator("#ai-invoice"), 600);
    await hold(1.6);
    await click(step(2).getByRole("button", { name: "Review with the agent's AI" }));
    await rec.waiting(() => step(2).locator(".ai-result").waitFor(), 1.0, 0.3);
    await scrollTo(step(2).locator(".ai-result"), 900, 120);
    await hover(step(2).locator(".ai-decision"), 600);
    await hold(1.6);
    await hover(step(2).locator(".ai-result .list.warn li").first(), 600);
    await hold(2.4);
    await scrollTo(step(2), 900, 90);
    await click(sample("Genuine invoice"));
    await hold(0.6);
    await click(step(2).getByRole("button", { name: "Review with the agent's AI" }));
    await rec.waiting(() => step(2).locator('.ai-result[data-decision="draft_mandate"]').waitFor(), 1.0, 0.3);
    await scrollTo(step(2).locator(".ai-result"), 900, 120);
    await hover(step(2).locator(".ai-decision"), 600);
    await hold(1.6);
    await click(step(2).getByRole("button", { name: "Use this draft for the mandate" }));
    await hold(1.4);
  });

  await scene("mandate", async () => {
    await scrollTo(step(3), 900, 90);
    await hover(step(3).locator(".summary"), 700);
    await hold(1.6);
    await click(page.getByRole("button", { name: /Seal, sign and send/ }));
    const steps = step(3).locator(".steps li");
    await rec.waiting(() => steps.nth(1).waitFor(), 1.0, 0.3);
    await hold(1.2);
    await rec.waiting(() => steps.filter({ hasText: /^Paid/ }).waitFor(), 0.6, 0.2);
    const n = await steps.count();
    for (let i = 2; i < n; i++) {
      await hover(steps.nth(i), 450);
      await hold(i === n - 2 ? 1.8 : 1.0);
    }
    await hold(0.8);
  });

  await scene("attack", async () => {
    await scrollTo(step(4), 900, 90);
    await click(page.getByRole("button", { name: /Play the stolen agent key/ }));
    const steps = step(4).locator(".steps li");
    await rec.waiting(() => steps.nth(1).waitFor(), 1.0, 0.2);
    await hover(steps.nth(1), 700);
    await hold(4.6);
  });

  await scene("dapps", async () => {
    await scrollTo(0, 700);
    await click(page.locator(".site-nav a", { hasText: "For dApps" }));
    await page.locator("pre.cli").first().waitFor();
    await hold(1.6);
    await scrollTo(page.locator("pre.cli").first(), 1100, 160);
    await hover(page.locator("pre.cli").first(), 800);
    await hold(3.0);
    await hover(page.getByRole("button", { name: "Request a window" }), 800);
    await hold(3.0);
  });

  await scene("outro", async () => {
    await page.goto(cards("outro"), { waitUntil: "networkidle" });
    rec.mark("go");
    await hold(vo("outro") + 0.9);
    await page.evaluate(() => (window as unknown as { leave(): void }).leave());
    await hold(0.8);
  });

  await ctx.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
