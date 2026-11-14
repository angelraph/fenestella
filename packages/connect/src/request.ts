import { isFenestellaMessage, MAX_REASON_LENGTH, PROTOCOL, type RequestMessage, type ResultMessage } from "./protocol";
import { validateWindowSpec, type FenestellaNetwork, type WindowSpec, type WindowState } from "./spec";

export interface RequestWindowOptions extends WindowSpec {
  /** Why your app needs it, in a sentence. Shown to the user as your words. */
  reason: string;
  network?: FenestellaNetwork;
  /** The account you expect to open the window, when you know it. */
  account?: string;
  /** Where Fenestella runs. Defaults to the public console. */
  fenestellaUrl?: string;
  /** Give up after this long. Default 10 minutes. */
  timeoutMs?: number;
}

export interface GrantedWindow {
  txHash: string;
  account: string;
  evmAddress: string;
  window: WindowState;
}

export type FenestellaErrorCode = "rejected" | "invalid" | "failed" | "blocked" | "closed" | "timeout";

export class FenestellaError extends Error {
  readonly code: FenestellaErrorCode;
  constructor(code: FenestellaErrorCode, message: string) {
    super(message);
    this.name = "FenestellaError";
    this.code = code;
  }
}

export const DEFAULT_FENESTELLA_URL = "https://fenestella.vercel.app";

/**
 * Ask the user to open an EVM authorisation window with exactly these bounds.
 * Opens the Fenestella approval page in a popup; the user sees your origin,
 * your reason and the bounds, and signs in their own wallet. Resolves once the
 * window is live on chain.
 *
 * Call it from a click handler, or the browser will block the popup.
 */
export function requestWindow(options: RequestWindowOptions): Promise<GrantedWindow> {
  const {
    reason,
    network = "testnet",
    account,
    fenestellaUrl = DEFAULT_FENESTELLA_URL,
    timeoutMs = 600_000,
    ...spec
  } = options;

  const errors = validateWindowSpec(spec);
  if (typeof reason !== "string" || reason.trim().length === 0) errors.push("A reason is required.");
  else if (reason.length > MAX_REASON_LENGTH) errors.push(`The reason is limited to ${MAX_REASON_LENGTH} characters.`);
  if (errors.length > 0) return Promise.reject(new FenestellaError("invalid", errors.join(" ")));
  if (typeof window === "undefined") {
    return Promise.reject(new FenestellaError("failed", "requestWindow runs in a browser."));
  }

  const base = new URL(fenestellaUrl, window.location.href);
  const id = randomId();
  const popup = window.open(new URL("/request", base).toString(), "fenestella-request", "popup,width=480,height=760");
  if (!popup) {
    return Promise.reject(
      new FenestellaError("blocked", "The browser blocked the Fenestella window. Call requestWindow from a click."),
    );
  }

  return new Promise<GrantedWindow>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(closedPoll);
      clearTimeout(timer);
      fn();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== base.origin || event.source !== popup) return;
      if (!isFenestellaMessage(event.data)) return;
      const msg = event.data;
      if (msg.type === "ready") {
        const request: RequestMessage = {
          protocol: PROTOCOL,
          type: "request",
          id,
          network,
          spec,
          reason: reason.trim(),
          account,
        };
        popup.postMessage(request, base.origin);
        return;
      }
      if (msg.type === "result" && msg.id === id) {
        const result: ResultMessage = msg;
        finish(() => {
          if (result.ok) {
            resolve({
              txHash: result.txHash,
              account: result.account,
              evmAddress: result.evmAddress,
              window: result.window,
            });
          } else {
            reject(new FenestellaError(result.code, result.message));
          }
        });
      }
    };

    const closedPoll = setInterval(() => {
      if (popup.closed) {
        finish(() => reject(new FenestellaError("closed", "The Fenestella window was closed before a decision.")));
      }
    }, 500);
    const timer = setTimeout(() => {
      finish(() => {
        try {
          popup.close();
        } catch {
          /* already gone */
        }
        reject(new FenestellaError("timeout", "No answer from Fenestella in time."));
      });
    }, timeoutMs);

    window.addEventListener("message", onMessage);
  });
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
