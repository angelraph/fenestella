import type { WindowSpec } from "@fenestella/connect";
import { minutesToBlocks } from "./format";

/**
 * Starting points for a window, in the order a person should consider them:
 * narrowest first. QoreX's own card offers only duration, count and cap;
 * these add the two scopes the chain supports and the wallet has no screen for.
 */
export interface WindowPreset {
  id: "one-contract" | "native-only" | "agent" | "session";
  title: string;
  blurb: string;
  minutes: number;
  maxTxs: number;
  maxValueQor: string;
  scope: "targets" | "native" | "any";
}

export const PRESETS: WindowPreset[] = [
  {
    id: "one-contract",
    title: "One contract",
    blurb: "Use a single dApp. Nothing else can be called.",
    minutes: 120,
    maxTxs: 20,
    maxValueQor: "5",
    scope: "targets",
  },
  {
    id: "native-only",
    title: "Plain transfers",
    blurb: "Send QOR from MetaMask. No contract can be touched.",
    minutes: 30,
    maxTxs: 5,
    maxValueQor: "2",
    scope: "native",
  },
  {
    id: "agent",
    title: "Agent errand",
    blurb: "Let a bot work against named contracts for a day, with a small budget.",
    minutes: 24 * 60,
    maxTxs: 100,
    maxValueQor: "10",
    scope: "targets",
  },
  {
    id: "session",
    title: "Open session",
    blurb: "Any contract, briefly. The widest choice: prefer one of the others.",
    minutes: 16,
    maxTxs: 5,
    maxValueQor: "1",
    scope: "any",
  },
];

export interface WindowDraft {
  minutes: number;
  maxTxs: number;
  maxValueQor: string;
  scope: "targets" | "native" | "any";
  /** One address per line or comma separated, as typed. */
  targetsText: string;
}

export function draftFromPreset(p: WindowPreset, targetsText = ""): WindowDraft {
  return { minutes: p.minutes, maxTxs: p.maxTxs, maxValueQor: p.maxValueQor, scope: p.scope, targetsText };
}

export function parseTargets(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Turn what the person typed into a spec. Amount errors surface from `qorToUqor`. */
export function draftToSpec(d: WindowDraft, blockSeconds: number, qorToUqor: (s: string) => bigint): WindowSpec {
  return {
    blocks: Math.min(17_280, minutesToBlocks(d.minutes, blockSeconds)),
    maxTxs: d.maxTxs,
    maxValueUqor: qorToUqor(d.maxValueQor).toString(),
    nativeOnly: d.scope === "native",
    allowedTargets: d.scope === "targets" ? parseTargets(d.targetsText) : [],
  };
}
