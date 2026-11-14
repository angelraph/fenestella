import { closeEvmWindowMsg, openEvmWindowMsg } from "@qorechain/sdk";
import { normalizeWindowSpec, type WindowSpec } from "@fenestella/connect";
import type { ChainMessage } from "./signer/types";

/** `MsgOpenEVMWindow` for a checked spec. Opening replaces any window already stored. */
export function openWindowMessage(sender: string, spec: WindowSpec): ChainMessage {
  const n = normalizeWindowSpec(spec);
  return openEvmWindowMsg({
    sender,
    blocks: n.blocks,
    maxTxs: n.maxTxs,
    maxValue: n.maxValueUqor,
    ...(n.nativeOnly ? { nativeOnly: true } : {}),
    ...(n.allowedTargets.length > 0 ? { allowedTargets: n.allowedTargets } : {}),
  });
}

/** `MsgCloseEVMWindow`. The revocation takes effect in the same block. */
export function closeWindowMessage(sender: string): ChainMessage {
  return closeEvmWindowMsg(sender);
}
