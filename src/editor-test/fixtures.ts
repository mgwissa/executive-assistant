/**
 * Representative markdown samples drawn from the app's real data model.
 * Each fixture names the behavior we care about preserving through the
 * parse → render → serialize round-trip.
 *
 * The critical invariants (set by src/lib/format.ts):
 *   - Checkbox lines match /^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/
 *   - `[P0]`-`[P4]` priority tags and `[due:YYYY-MM-DD]` tags are inline
 *     text inside the checkbox label and must survive as literal text.
 *   - Continuation lines under a checkbox (indented ≥2 spaces deeper than
 *     the checkbox's own indent) are the task's "free-form notes" and
 *     must round-trip as indented child content.
 */
export type Fixture = {
  name: string;
  /** What we care about preserving in this case. */
  what: string;
  input: string;
};

export const fixtures: Fixture[] = [
  {
    name: 'plain checkbox',
    what: 'Unchecked GFM task list item with `- [ ]` syntax.',
    input: `- [ ] Buy milk\n`,
  },
  {
    name: 'checked checkbox',
    what: 'Checked GFM task list item with `- [x]` syntax.',
    input: `- [x] Done thing\n`,
  },
  {
    name: 'checkbox with priority tag',
    what: 'Inline `[P2]` tag preserved literally inside the checkbox text.',
    input: `- [ ] [P2] Buy milk\n`,
  },
  {
    name: 'checkbox with priority and due-date tags',
    what: 'Inline `[P1]` and `[due:2026-05-01]` tags both preserved.',
    input: `- [ ] [P1] Buy milk [due:2026-05-01]\n`,
  },
  {
    name: 'checkbox with continuation notes',
    what:
      "Indented paragraph under a checkbox becomes the task's description. " +
      'Must come back as indented child content.',
    input:
      `- [ ] Plan Q3 launch\n` +
      `  Kickoff is next Monday. Need to confirm with the\n` +
      `  design team about assets.\n`,
  },
  {
    name: 'multiple checkboxes with mixed priorities',
    what: 'Several checkboxes in sequence, some checked, with priority tags.',
    input:
      `- [x] [P3] Low-priority thing\n` +
      `- [ ] [P2] Medium-priority thing\n` +
      `- [ ] [P0] Critical thing [due:2026-04-24]\n`,
  },
  {
    name: 'nested sub-tasks',
    what: 'Child list items under a parent checkbox, both as GFM tasks.',
    input:
      `- [ ] Ship new editor\n` +
      `  - [ ] [P2] Pick library\n` +
      `  - [ ] [P1] Write round-trip tests\n` +
      `  - [ ] Roll out\n`,
  },
  {
    name: 'headings and paragraphs',
    what: 'Heading levels and paragraph spacing preserved.',
    input:
      `# Project notes\n` +
      `\n` +
      `Some context about what we're doing.\n` +
      `\n` +
      `## Goals\n` +
      `\n` +
      `Make it good.\n`,
  },
  {
    name: 'inline formatting',
    what: '`**bold**`, `*italic*`, `` `inline code` ``, and [links](url).',
    input:
      `This has **bold**, *italic*, \`inline code\`, and a ` +
      `[link](https://example.com) in it.\n`,
  },
  {
    name: 'code block',
    what: 'Fenced code block with language tag preserved.',
    input:
      `Example:\n` +
      `\n` +
      `\`\`\`ts\n` +
      `const x = 1;\n` +
      `console.log(x);\n` +
      `\`\`\`\n`,
  },
  {
    name: 'realistic mixed note',
    what:
      'A believable full note with heading, context, and a checkbox block ' +
      'with priority + due + continuation notes — the shape your real notes take.',
    input:
      `# Launch checklist\n` +
      `\n` +
      `Owner: me. Target: end of month.\n` +
      `\n` +
      `- [ ] [P0] Finalize pricing page [due:2026-04-25]\n` +
      `  Waiting on legal for the comparison copy. Ping Sarah on Monday\n` +
      `  if nothing lands.\n` +
      `- [x] [P2] Draft announcement email\n` +
      `- [ ] [P1] Brief support team\n` +
      `  Deck is in /shared/support-brief.pdf.\n`,
  },
];
