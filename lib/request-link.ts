import { PROTOCOL, type RequestMessage } from "@fenestella/connect";

/**
 * A window request carried in a link (`/request?r=…`), for agents that have no
 * browser to open a popup from, such as the MCP server. The page shows the
 * request exactly like a popup request, but says plainly that nothing vouches
 * for who sent the link. Pure: shared by the MCP server, the page and tests.
 */
export interface LinkRequest {
  network: RequestMessage["network"];
  spec: RequestMessage["spec"];
  reason: string;
  account?: string;
  /** The name the agent gives itself. Shown, never trusted. */
  from: string;
  id?: string;
}

const MAX_FROM = 60;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeRequestLink(base: string, r: LinkRequest): string {
  const body = { id: r.id ?? `link-${Date.now()}`, network: r.network, spec: r.spec, reason: r.reason, account: r.account, from: r.from.slice(0, MAX_FROM) };
  return `${base.replace(/\/$/, "")}/request?r=${toBase64Url(new TextEncoder().encode(JSON.stringify(body)))}`;
}

/** The request in `?r=`, or null when there is none or it does not parse. Validation is the page's job. */
export function decodeRequestLink(search: string): { request: RequestMessage; from: string } | null {
  const r = new URLSearchParams(search).get("r");
  if (!r) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(fromBase64Url(r))) as Partial<RequestMessage> & { from?: unknown };
    if (!body || typeof body !== "object") return null;
    return {
      request: {
        protocol: PROTOCOL,
        type: "request",
        id: String(body.id ?? "link"),
        network: body.network as RequestMessage["network"],
        spec: body.spec as RequestMessage["spec"],
        reason: typeof body.reason === "string" ? body.reason : "",
        account: typeof body.account === "string" ? body.account : undefined,
      },
      from: (typeof body.from === "string" && body.from.trim() ? body.from : "an AI agent").slice(0, MAX_FROM),
    };
  } catch {
    return null;
  }
}
