import type { FenestellaNetwork, WindowSpec, WindowState } from "./spec";

/**
 * Messages between a dApp and the Fenestella approval page. The page is opened
 * as a popup; the two sides talk with `postMessage`, and each side checks the
 * browser-reported origin of every message. Nothing secret crosses: the dApp
 * sends what it wants, Fenestella answers with what the user signed.
 */
export const PROTOCOL = "fenestella/1" as const;

export interface ReadyMessage {
  protocol: typeof PROTOCOL;
  type: "ready";
}

export interface RequestMessage {
  protocol: typeof PROTOCOL;
  type: "request";
  id: string;
  network: FenestellaNetwork;
  spec: WindowSpec;
  /** Shown to the user, as the dApp's own words. At most 280 characters. */
  reason: string;
  /** The account the dApp expects, when it knows it (`qor1…` or `0x…`). */
  account?: string;
}

export type ResultMessage =
  | {
      protocol: typeof PROTOCOL;
      type: "result";
      id: string;
      ok: true;
      txHash: string;
      /** The account that opened the window (`qor1…`). */
      account: string;
      evmAddress: string;
      window: WindowState;
    }
  | {
      protocol: typeof PROTOCOL;
      type: "result";
      id: string;
      ok: false;
      /** `rejected`: the user said no. `invalid`: the request was refused. `failed`: signing or the chain failed. */
      code: "rejected" | "invalid" | "failed";
      message: string;
    };

export type FenestellaMessage = ReadyMessage | RequestMessage | ResultMessage;

export function isFenestellaMessage(data: unknown): data is FenestellaMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { protocol?: unknown }).protocol === PROTOCOL &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

export const MAX_REASON_LENGTH = 280;
