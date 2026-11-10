import type { JsonStore } from '../storage/store';
import type { LLMProvider } from '../llm/provider';
import type { SectionRef, IR } from './api';

/** Store titles separately so parser structure and generation boundaries never change. */
export async function sectionTitles(sourceId: string, sections: SectionRef[], ir: IR, store: JsonStore, provider: LLMProvider): Promise<SectionRef[]> {
  if (!sections.length) return sections;
  const key = `titles-${sourceId}`;
  const signature = JSON.stringify(sections.map(s => [s.id, s.title]));
  const valid = (value: unknown): value is string[] => Array.isArray(value) && value.length === sections.length && value.every(t => typeof t === 'string' && !!t.trim() && t.length <= 200);
  const cached = await store.read<{ signature: string; titles: string[] }>(key).catch(() => null);
  let titles = cached?.signature === signature && valid(cached.titles) ? cached.titles : undefined;
  if (!titles) {
    const nodes = new Map<string, Record<string, unknown>>();
    const visit = (items: IR['sections']) => { for (const item of items) { nodes.set(item.id, item); visit(item.children); } };
    visit(ir.sections);
    const response = await provider.complete(`Clean these PDF section titles into concise readable headings. Fix OCR, fragments, footer and parser nonsense using the text excerpt. Preserve numbering when useful. Return ONLY a JSON array of strings, exactly one title for each input in the same order; never merge, remove or add sections.\n${JSON.stringify(sections.map(s => ({ title: s.title, excerpt: String(nodes.get(s.id)?.markdown ?? '').slice(0, 450) })))}`, { model: 'haiku', timeoutMs: 45000 });
    const parsed: unknown = JSON.parse(response.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!valid(parsed)) throw new Error('Invalid section titles');
    titles = parsed.map(t => t.trim());
    await store.write(key, { signature, titles });
  }
  return sections.map((section, i) => ({ ...section, title: titles![i] }));
}
