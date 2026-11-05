"""Pure segment layout and alignment offset logic (no models)."""

from tangent_sidecar.tts import alignable, layout_segments, merge_alignments


def test_layout_puts_gaps_between_segments_only():
    assert layout_segments([100, 50, 10], 20) == ([(0, 100), (120, 170), (190, 200)], 200)
    assert layout_segments([100], 20) == ([(0, 100)], 100)
    assert layout_segments([30, 30], 0) == ([(0, 30), (30, 60)], 60)


def test_merge_offsets_word_times_by_segment_start():
    per = [[{"word": "One", "start": 0.1, "end": 0.4}],
           [{"word": "two", "start": 0.05, "end": 0.3}, {"word": "three.", "start": 0.35, "end": 0.6}]]
    words, segments = merge_alignments(per, [(0, 24000), (36000, 60000)], 24000)
    assert segments == [{"start": 0.0, "end": 1.0}, {"start": 1.5, "end": 2.5}]
    assert words == [{"word": "One", "start": 0.1, "end": 0.4},
                     {"word": "two", "start": 1.55, "end": 1.8},
                     {"word": "three.", "start": 1.85, "end": 2.1}]


def test_alignable_drops_tokens_without_letters():
    assert alignable("Hello, 42 !!! it's") == [("Hello,", "hello"), ("it's", "it's")]
