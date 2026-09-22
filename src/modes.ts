export type ModeName =
  | "analyze"
  | "explain"
  | "fix"
  | "summarize"
  | "review"
  | "test";

export const MODE_NAMES: readonly ModeName[] = [
  "analyze",
  "explain",
  "fix",
  "summarize",
  "review",
  "test",
] as const;

const MODE_INSTRUCTIONS: Record<ModeName, string> = {
  analyze: [
    "You are analyzing terminal output, logs, or an error report provided below.",
    "Explain what happened, identify the root cause of any errors,",
    "and suggest concrete next steps. Be direct and specific.",
  ].join(" "),
  explain: [
    "You are explaining the code or output below to a newcomer.",
    "Describe what it does, how the parts fit together, and any concepts",
    "a reader would need to understand it. No fixes, no review — explanation only.",
  ].join(" "),
  fix: [
    "The code or output below has a problem. Propose a concrete fix.",
    "When the input is code, output a unified diff or the full corrected file.",
    "Explain the fix briefly after the code block.",
  ].join(" "),
  summarize: [
    "Summarize the content below as terse bullet points (at most 15 bullets).",
    "Capture only what matters: outcomes, errors, key numbers, decisions.",
  ].join(" "),
  review: [
    "Perform a code review of the content below.",
    "Report bugs, risks, and style issues as a prioritized list of findings.",
    "For each finding give severity, location, and a suggested change.",
  ].join(" "),
  test: [
    "Generate unit tests for the code below.",
    "Match the language and idioms of the input; prefer the ecosystem's",
    "standard test runner. Cover edge cases, not just the happy path.",
  ].join(" "),
};

export interface PromptOptions {
  mode: ModeName;
  input: string;
  question?: string;
  /** Extra context sections: [{ path, content }] appended after the main input. */
  context?: Array<{ path: string; content: string }>;
  /** Send input verbatim with no mode wrapper. */
  raw?: boolean;
}

/** Assemble the final prompt sent to Claude Code. */
export function buildPrompt(opts: PromptOptions): string {
  const sections: string[] = [];

  if (opts.raw) {
    sections.push(opts.input);
  } else {
    sections.push(MODE_INSTRUCTIONS[opts.mode]);
    sections.push("");
    sections.push("----- BEGIN INPUT -----");
    sections.push(opts.input);
    sections.push("----- END INPUT -----");
  }

  if (opts.context && opts.context.length > 0) {
    for (const ctx of opts.context) {
      sections.push("");
      sections.push(`--- context: ${ctx.path} ---`);
      sections.push(ctx.content);
    }
  }

  if (opts.question) {
    sections.push("");
    sections.push(`Additional question from the user: ${opts.question}`);
  }

  return sections.join("\n");
}

export function isModeName(value: string): value is ModeName {
  return (MODE_NAMES as readonly string[]).includes(value);
}
