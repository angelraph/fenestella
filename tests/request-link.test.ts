import { describe, expect, it } from "vitest";
import { validateWindowSpec } from "@fenestella/connect";
import { decodeRequestLink, encodeRequestLink } from "../lib/request-link";

const spec = { blocks: 563, maxTxs: 2, maxValueUqor: "300000", nativeOnly: false, allowedTargets: ["0x51fb13cc0513f02cd16e98f9b4a9f233027c2551"] };

describe("window requests carried in a link (MCP agents)", () => {
  it("round-trips a request, reason and account included", () => {
    const url = encodeRequestLink("https://fenestella.vercel.app/", { network: "testnet", spec, reason: "Pay this month’s hosting — ünïcode too", account: "qor1abc", from: "My agent" });
    expect(url.startsWith("https://fenestella.vercel.app/request?r=")).toBe(true);
    const got = decodeRequestLink(new URL(url).search)!;
    expect(got.request.spec).toEqual(spec);
    expect(got.request.reason).toBe("Pay this month’s hosting — ünïcode too");
    expect(got.request.account).toBe("qor1abc");
    expect(got.request.network).toBe("testnet");
    expect(got.from).toBe("My agent");
  });

  it("uses only URL-safe characters", () => {
    const url = encodeRequestLink("https://x", { network: "testnet", spec, reason: "?".repeat(200), from: "a" });
    expect(new URL(url).searchParams.get("r")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("caps the name the agent gives itself and defaults it", () => {
    const long = decodeRequestLink(new URL(encodeRequestLink("https://x", { network: "testnet", spec, reason: "r", from: "x".repeat(500) })).search)!;
    expect(long.from.length).toBe(60);
    const none = decodeRequestLink(new URL(encodeRequestLink("https://x", { network: "testnet", spec, reason: "r", from: "  " })).search)!;
    expect(none.from).toBe("an AI agent");
  });

  it("returns null for no request or garbage, and leaves validation to the page", () => {
    expect(decodeRequestLink("")).toBeNull();
    expect(decodeRequestLink("?r=%%%")).toBeNull();
    expect(decodeRequestLink("?r=bm90IGpzb24")).toBeNull();
    const bad = decodeRequestLink(new URL(encodeRequestLink("https://x", { network: "testnet", spec: { ...spec, maxTxs: 5000 }, reason: "r", from: "a" })).search)!;
    expect(validateWindowSpec(bad.request.spec).length).toBeGreaterThan(0);
  });
});
