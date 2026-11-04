// Defensive twin of sidecar postprocess.strip_footers: no watermark/person name may reach a prompt.
const ZYBOOKS = /©\s*zyBooks.*$/i; // "©zyBooks MM/DD/YY HH:MM EDT <id> <name> <COURSE+TERM>"
const STAMP = /\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}.*\d{6,}.*$/; // date, time, ..., numeric id, rest of line
const FOOTER = /^[\s*_>|]*(?:©|\(c\)\s|copyright\b).{0,160}$/i;
const MARKUP_ONLY = /^[\s*_>|]*$/;

export function stripWatermarks(markdown: string): string {
  return markdown.split("\n").flatMap(line => {
    if (FOOTER.test(line)) return [];
    const cut = line.replace(ZYBOOKS, "").replace(STAMP, "");
    return cut !== line && MARKUP_ONLY.test(cut) ? [] : [cut];
  }).join("\n");
}
