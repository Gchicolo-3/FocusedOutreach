// Shared output hygiene for the reply generator routes (form + chat).
// The prompts forbid markdown, em dashes, and placeholder names, but models
// still slip — enforce deterministically on every draft variant.

// The output must be paste-ready plain text.
export function sanitizeReply(text: string): string {
  let out = text.trim();
  // Markdown bold/italic wrappers, keep the inner text.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?;:]|$)/g, '$1$2');
  // Markdown headers at line start.
  out = out.replace(/^#{1,6}\s+/gm, '');
  // Em/en dashes: spaced ones become a comma pause, bare ones too.
  out = out.replace(/\s+[—–]\s+/g, ', ');
  out = out.replace(/[—–]/g, ', ');
  // Model preambles like "Here's a draft:" on the first line.
  out = out.replace(/^(here('|')s|here is)[^\n]*:\s*\n+/i, '');
  return out.trim();
}

// [name] / [First Name] style placeholders that templates and prompt examples
// use for an unknown recipient. Shipping one in a real draft is a bug.
export function hasNamePlaceholder(text: string): boolean {
  return /\[\s*(?:first\s*name|name)\s*\]/i.test(text);
}

export function fillNamePlaceholders(text: string, firstName: string): string {
  return text.replace(/\[\s*(?:first\s*name|name)\s*\]/gi, firstName);
}
