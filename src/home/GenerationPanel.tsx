import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import Icon from '@/components/Icon';
import { DETAIL_LEVELS, type DetailLevel } from '../gen/script';

const detailLabel: Record<DetailLevel, string> = { overview: 'Overview', standard: 'Standard', detailed: 'Detailed', complete: 'Complete' };
const detailHint: Record<DetailLevel, string> = {
  overview: 'Key ideas only. Shortest video.', standard: 'Key ideas, main definitions and examples.',
  detailed: 'Every idea, example and important caveat.', complete: 'Covers everything in the section. Longest video.',
};

/** Pinned bottom panel for "Make a video": detail level, length estimate, Cancel / Make video. */
export default function GenerationPanel({ count, summary, detail, onDetail, minutesFor, generating, onCancel, onMake }: {
  count: number; summary?: string; detail: DetailLevel; onDetail: (d: DetailLevel) => void; minutesFor: (d: DetailLevel) => number;
  generating: boolean; onCancel: () => void; onMake: () => void;
}) {
  return <div className="tl-generation"><div className="tl-generation-top"><span id="video-detail-label">Detail level</span>{summary && <small>{summary}</small>}</div>
    <div className="tl-detail" role="radiogroup" aria-labelledby="video-detail-label">{DETAIL_LEVELS.map(d => {
      const minutes = minutesFor(d);
      const length = minutes ? `about ${minutes} min` : "";
      return <label key={d} className={detail === d ? "tl-picked" : ""}><input type="radio" name="video-detail" value={d} checked={detail === d} aria-label={length ? `${detailLabel[d]}, ${length}` : detailLabel[d]} onChange={() => onDetail(d)} /><span>{detailLabel[d]}</span>{length && <small>{length}</small>}</label>;
    })}</div>
    <p>{detailHint[detail]} Sections and detail set the length.</p><div className="tl-generation-bottom"><button className="tl-text-button" disabled={generating} onClick={onCancel}>Cancel</button><button className="tl-primary" disabled={!count || generating} onClick={onMake}>{generating ? 'Starting…' : `Make video${count ? ` · ${count} selected` : ''}`}<Icon icon={ArrowRight01Icon} size={16} /></button></div>
  </div>;
}
