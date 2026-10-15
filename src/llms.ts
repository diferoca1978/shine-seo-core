// llms.txt builders: plain markdown strings, no Response. Optional: Google Search ignores
// llms.txt (reference §11), though other services may read it. A project composes them in
// src/pages/llms.txt.ts. Every input is a parameter.

export interface LlmsItem {
  title: string;
  url?: string; // omitted → a plain bullet, no link
  notes?: string;
}

// `# title`, plus a `> summary` blockquote when the summary is not absent or blank.
export function header(title: string, summary?: string): string {
  if (!summary?.trim()) return `# ${title}\n`;
  return `# ${title}\n\n> ${summary}\n`;
}

// One bullet: a markdown link when `url` is given, the bare title when it is absent, and
// `: notes` after either when `notes` is given. `]` and `)` in the title are not escaped.
export function doc(item: LlmsItem): string {
  const label = item.url === undefined ? item.title : `[${item.title}](${item.url})`;
  const suffix = item.notes === undefined ? '' : `: ${item.notes}`;
  return `- ${label}${suffix}`;
}

// A `## heading` section with one bullet per item, or '' when there are no items, so a
// caller can push it unconditionally and llmsTxt() drops it.
export function linkList(heading: string, items: LlmsItem[]): string {
  if (items.length === 0) return '';
  return `## ${heading}\n\n` + items.map(doc).join('\n');
}

// The whole document: the header and every section that is not '', joined with '\n\n',
// plus one trailing '\n'.
export function llmsTxt(header: string, sections: string[]): string {
  return [header, ...sections.filter((section) => section !== '')].join('\n\n') + '\n';
}
