import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Super-app TOOL REGISTRY — the modular core that keeps breadth cheap.
//
// Every capability (data analysis, document Q&A, rewrite, plagiarism, …) is a
// self-contained Tool: an id, a credit cost, a matcher, and a handler. New tools
// drop in here without touching the conversation engine. The dispatcher picks the
// best-matching tool for an incoming message/attachment and runs it.
// ─────────────────────────────────────────────────────────────────────────────

export type ToolAttachment = { base64: string; filename: string; mimeType: string };

export type ToolInput = {
  text?: string; // caption or the message text accompanying a file
  attachment?: ToolAttachment;
};

export type ToolContext = {
  assistant: string; // the org / service name replying
  contactName?: string;
  lang?: string; // detected language hint (optional)
};

export type ToolResult = {
  reply: string;
  document?: { url: string; filename: string };
  /** Set when the tool didn't actually do billable work (guidance/validation
   *  message, unreadable file) — the dispatcher then charges nothing. */
  noCharge?: boolean;
};

export type Tool = {
  id: string;
  name: string;
  description: string;
  /** Credits charged on a successful run. */
  cost: number;
  /** Does this tool handle the given input? Higher-priority tools are listed first. */
  matches: (input: ToolInput) => boolean;
  run: (input: ToolInput, ctx: ToolContext) => Promise<ToolResult>;
};

const registry: Tool[] = [];

/** Register a tool (called by each tool module at import time). Replaces an
 *  existing tool with the same id, so hot-reload / re-imports pick up changes. */
export function registerTool(tool: Tool): void {
  const i = registry.findIndex((t) => t.id === tool.id);
  if (i >= 0) registry[i] = tool; else registry.push(tool);
}

/** All registered tools (for menus, pricing pages, etc.). */
export function allTools(): Tool[] {
  return [...registry];
}

/** Pick the first tool that matches this input, or null. */
export function pickTool(input: ToolInput): Tool | null {
  return registry.find((t) => t.matches(input)) ?? null;
}

// ── Small helpers shared by tools ───────────────────────────────────────────

/** File extension (lowercase, no dot) from a filename. */
export function extOf(filename?: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename ?? "");
  return m ? m[1].toLowerCase() : "";
}

/** Decode a base64 attachment to a UTF-8 string (for text-based files). */
export function decodeText(att: ToolAttachment): string {
  return Buffer.from(att.base64, "base64").toString("utf8");
}
