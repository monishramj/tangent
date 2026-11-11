import type { JsonStore } from '../storage/store';
import type { LLMProvider } from '../llm/provider';
import { dataBlock, dataReminder, dataRule, sanitizeModelText, stripWatermarks } from '../gen/sanitize';
import type { SectionRef, IR } from './api';

export const junkHeading = (title: string) => {
  const text = stripWatermarks(title).trim();
  return !text || /^(?:(?:section|chapter|part|page|p\.?|untitled|heading)\s*[\d.ivxlcdm-]*|\d+)$/i.test(text)
    || /^(?:summary|notes|key terms|review|introduction|conclusions?|a clinical case|contents|readings?|further reading)$/i.test(text)
    || text.split(/\s+/).length > 8 || /[.!?;,:-]$/.test(text)
    || /^(?:and|or|but|because|which|that|of|to)\b|\b(?:and|or|the|of|to|with|is|are)$/i.test(text);
};
const cleanTitle = (value: unknown) => sanitizeModelText(value, 100).replace(/\s+/g, ' ').split(' ').slice(0, 8).join(' ');
export type SectionTitles = { sections: SectionRef[]; incomplete: boolean };

/** Store titles separately so parser structure and generation boundaries never change. */
export async function sectionTitles(sourceId: string, sections: SectionRef[], ir: IR, store: JsonStore, provider: LLMProvider, retry = false): Promise<SectionTitles> {
  if (!sections.length) return { sections, incomplete: false };
  const key = `titles-${sourceId}`;
  const signature = JSON.stringify(sections.map(s => [s.id, s.title]));
  const cached = await store.read<{ signature: string; titles: unknown[] }>(key).catch(() => null);
  const hit = cached?.signature === signature && Array.isArray(cached.titles) && cached.titles.length === sections.length;
  const titles = sections.map((_, i) => hit ? cleanTitle(cached.titles[i]) || null : null);
  if (!hit || retry) {
    const nodes = new Map<string, IR['sections'][number]>();
    const visit = (items: IR['sections']) => { for (const item of items) { nodes.set(item.id, item); visit(item.children); } };
    visit(ir.sections);
    const counts = new Map<string, number>();
    for (const s of sections) counts.set(s.title.toLowerCase(), (counts.get(s.title.toLowerCase()) ?? 0) + 1);
    const missing = sections.map((section, index) => ({ section, index })).filter(({ index }) => !titles[index]);
    for (let offset = 0; offset < missing.length; offset += 40) {
      const batch = missing.slice(offset, offset + 40);
      const inputs = batch.map(({ section, index }) => ({
        id: section.id,
        title: stripWatermarks(section.title),
        deriveFromText: junkHeading(section.title) || (counts.get(section.title.toLowerCase()) ?? 0) > 2,
        context: stripWatermarks(sections[Math.max(0, index - 1)].title),
        excerpt: stripWatermarks(String(nodes.get(section.id)?.markdown ?? '')).replace(/\(file:\/\/[^)\n]*\)/gi, '').slice(0, 1200),
      }));
      try {
        const response = await provider.complete(`Give each PDF section a short, specific, scannable title (at most 8 words). Keep good real headings, just tidy capitalization and OCR. When deriveFromText is true, or the heading is a running header, page number, empty, generic or a sentence fragment, name what that section's OWN excerpt actually covers. Replace generic labels even when correctly spelled: use the specific topic instead of bare Summary, Notes, Introduction or A Clinical Case. Context is only a clue; never invent content for an empty excerpt. These are titles, not summaries. Return ONLY a JSON object mapping each input id to its title string. Use null if there is insufficient information. Keep every id exactly as given; never merge or add sections.\n${dataRule(['section'])}\n${dataBlock('section', JSON.stringify(inputs))}\n${dataReminder(['section'])}`, { model: 'haiku', timeoutMs: 120000 });
        const parsed: unknown = JSON.parse(response.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid section titles');
        batch.forEach(({ section, index }, i) => {
          const title = cleanTitle((parsed as Record<string, unknown>)[section.id]);
          titles[index] = title && !(inputs[i].deriveFromText && inputs[i].excerpt.trim() && junkHeading(title)) ? title : null;
        });
      } catch (error) {
        console.warn('Section title cleanup failed:', error);
      }
      // Checkpoint each batch, including failures, so reopening never repeats successful work.
      await store.write(key, { signature, titles });
    }
  }
  return { sections: sections.map((section, i) => ({ ...section, title: titles[i] ?? section.title })), incomplete: titles.some(t => !t) };
}
