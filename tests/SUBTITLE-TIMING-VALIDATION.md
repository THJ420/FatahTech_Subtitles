# Manual subtitle timing

Validated locally on 2026-09-10 with `tests/fixtures/speech.mp4`.

- Desktop: selected a line and changed its start using the exact-time field.
- Dragged the right edge from 0.940 to 1.140 seconds; Undo restored 0.940.
- Moved a line by 0.100 seconds; both endpoints moved by the same amount.
- Reset restored the original line boundaries, 0.100 and 0.940 seconds.
- Word mode: changed one word without moving the adjacent word.
- A requested end time of 9.000 seconds was rejected because it crossed adjacent words.
- Dragged a word's left edge from 0.200 to 0.300 seconds. Caption handles remain reachable when the playhead overlaps them.
- Escape during a drag restored the timing before that drag.
- Mobile at 390 × 844: Start and End fields were fully visible and editable, with Undo and Reset on a separate row.
- Downloaded JSON, SRT, and WebVTT and read their contents. The first word had the edited interval 0.200–0.400 seconds in each file.
- Exported an MP4 successfully after timing edits (5,195,463 bytes).

Automated coverage in `subtitle-timing.test.ts` checks word and line boundaries, preserved word spacing, source video cuts, timing-only Undo, Reset conflicts, preview lookup, subtitle exports, repeated worker updates, exact-time parsing, and millisecond rounding. The full suite passed with 107 tests. TypeScript, lint on changed code, and the production build passed.

Timing controls use source-video seconds. `timestamp` is the editable subtitle interval; `sourceTimestamp` retains the original media interval for video cuts and Reset. If Reset would overlap a neighboring word, it is refused with a message. Undo the adjacent timing edit first.
