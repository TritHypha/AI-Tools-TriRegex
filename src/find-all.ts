// =============================================================================
// TriRegex — certified findAll: every non-overlapping leftmost-longest match,
// in ONE forward pass over the input.
//
// Why not "call test() on each suffix": the independent re-read of that first
// design measured it — the per-round suffix copy is uncounted O(N) work, and
// under uniformScan (no early exit) every round rescans its whole suffix, so
// Σ suffix lengths is O(N²) and the "linear" bound was VIOLATED (measured:
// N=2000 → 2,013,003 steps against a 30,003 bound). A bound that only holds
// in the mode with an early exit is not a bound. So findAll owns a single
// forward scan that RESUMES the state set at each match end instead of
// re-materialising suffixes; each code point is stepped exactly once.
//
// The scan is the engine's own certified step (identical bitset/row work), so
// the derived bound is exact and mode-independent:
//
//   steps ≤ N · perCharWorkBound + (segments + 1) · boundaryWorkBound      (★)
//
// where a "segment" begins at position 0 and after every emitted match. Each
// segment's start pays one boundary (its initial closure); the +1 is the final
// end-of-input resolution. `tests/find-all.test.mjs` asserts steps ≤ bound in
// BOTH modes on the classic killers over adversarial input.
//
// Semantics, stated so they cannot be assumed:
//   * Matches are non-overlapping, leftmost-longest, in input order. Within a
//     segment the leftmost start wins; at that start the longest end wins; the
//     match is FINAL once every live thread started later than it (or input
//     ends), exactly as the single-match engine decides.
//   * After a non-empty match the next segment starts AT the match end (a fresh
//     start closure there — `initMid`, or `initStart` only at true position 0);
//     after an EMPTY match at position p the cursor advances one code point (the
//     JS matchAll / RE2 rule) so an empty-matching pattern cannot loop.
//   * `^`-anchored patterns: only true position 0 is a legal start, so at most
//     one match exists and the scan stops after the first segment. `$` needs no
//     special case — the scan reaches the real end.
//   * `maxMatches` fail-CLOSES: exceeding it sets `truncated: true` and the
//     caller decides; it is never silent.
// Contact hello@trithypha.dev · Apache-2.0.
// =============================================================================
import type { Compiled } from "./compile.ts";
import { inRangesWithCost } from "./compile.ts";
import type { CostCertificate } from "./types.ts";

const INF = 0x7fffffff;

export interface FindAllOptions {
  /** Hard cap on matches returned; exceeding it is REPORTED via `truncated`. Default 10_000. */
  maxMatches?: number;
}

export interface FindAllResult {
  /** Non-overlapping [start, end) spans in code POINTS, input order. */
  spans: ReadonlyArray<readonly [number, number]>;
  /** True when maxMatches stopped the scan before end of input — never silent. */
  truncated: boolean;
  /** Certified work units actually performed. */
  steps: number;
  /** The derived work bound (★) — steps must not exceed it, in every mode. */
  stepsBound: number;
  /** Segments scanned (1 + emitted matches, unless truncated/anchored). */
  segments: number;
  /** Code points consumed. */
  chars: number;
}

/**
 * Enumerate every non-overlapping leftmost-longest match of `c` in `input`
 * with a single certified forward pass. `uniformScan` disables the mid-segment
 * early finalisation only (matches the engine's flag); the bound holds either way.
 */
export function findAll(
  c: Compiled,
  certificate: CostCertificate,
  uniformScan: boolean,
  input: string,
  opts: FindAllOptions = {},
): FindAllResult {
  const maxMatches = opts.maxMatches ?? 10_000;
  const words = c.words;
  let cur = new Uint32Array(words);
  let nxt = new Uint32Array(words);
  let curStart = new Int32Array(c.slots).fill(INF);
  let nxtStart = new Int32Array(c.slots).fill(INF);
  const spans: Array<readonly [number, number]> = [];
  let steps = 0;
  let segments = 0;
  let truncated = false;

  // The HELD match: leftmost-longest so far, not yet emitted. `matched` means
  // "a match is held". A second slot, NEXT, holds the best candidate that
  // starts at or after the held match's END — i.e. a match of the FOLLOWING
  // segment, observed early because all threads run concurrently. Its mere
  // existence proves the held match final: nothing un-emitted can start before
  // it. Two slots suffice: a third non-overlapping match cannot be observed
  // before NEXT is itself final, because a match ending at e is only known
  // once position e is consumed, and by then everything before it has settled.
  let matched = false, matchStart = INF, matchEnd = -1, curMinStart = INF;
  let hasNext = false, nextStart = INF, nextEnd = -1;
  // Threads that started INSIDE an emitted match must not survive into the
  // next segment (non-overlap). `floor` is the earliest legal start for any
  // thread or match after the last emission; anything below it is pruned.
  let floor = 0;
  // An empty match at position p is emitted once; the next segment may not
  // re-emit empty-at-p (it would loop). Only empty-at-p is suppressed — a
  // non-empty match starting at p is still legal (JS matchAll rule).
  let noEmptyAt = -1;
  let stopped = false;

  const latch = (st: number, en: number): void => {
    if (st < floor) return;                       // overlaps an emitted match
    if (st === en && st === noEmptyAt) return;    // empty-at-p already emitted
    if (!matched) { matched = true; matchStart = st; matchEnd = en; return; }
    if (st < matchStart || (st === matchStart && en > matchEnd)) {
      // A better held match. Anything queued in NEXT that now overlaps it is
      // void; anything still clear of its end stays queued.
      matchStart = st; matchEnd = en;
      if (hasNext && nextStart < matchEnd) { hasNext = false; nextStart = INF; nextEnd = -1; }
      return;
    }
    // Later than the held match: a NEXT-segment candidate only if it clears the
    // held END (non-overlap). Leftmost-longest among NEXT candidates.
    if (st >= matchEnd && (!hasNext || st < nextStart || (st === nextStart && en > nextEnd))) {
      hasNext = true; nextStart = st; nextEnd = en;
    }
    // A candidate starting inside (matchStart, matchEnd) can never win: it
    // overlaps a match that is leftmost. Dropped, correctly.
  };

  /** Prune every live thread that started below `floor` (they overlap the
   *  emitted match) and recompute curMinStart. One certified pass over slots. */
  const pruneBelowFloor = (): void => {
    curMinStart = INF;
    for (let s = 0; s < c.slots; s++) {
      steps++;
      if (!((cur[s >> 5]! >>> (s & 31)) & 1)) continue;
      if (curStart[s]! < floor) { cur[s >> 5] = (cur[s >> 5]! & ~(1 << (s & 31))) >>> 0; curStart[s] = INF; }
      else if (curStart[s]! < curMinStart) curMinStart = curStart[s]!;
    }
  };

  /** Emit the held match and open the next segment. The live state set is KEPT:
   *  every thread that started at or after matchEnd is exactly the next
   *  segment's state (they were stepped over the same characters); threads that
   *  started inside the match are pruned. Returns false when the scan must stop
   *  (cap reached, or a start-anchored pattern which can match only once). */
  const emitAndResume = (): boolean => {
    spans.push([matchStart, matchEnd]);
    segments++;
    const wasEmpty = matchEnd === matchStart;
    floor = wasEmpty ? matchStart : matchEnd;
    noEmptyAt = wasEmpty ? matchStart : -1;
    // Promote NEXT (if any) to held: it was already proven clear of the
    // emitted match's end, so it is the next segment's leftmost-longest so far.
    if (hasNext) { matched = true; matchStart = nextStart; matchEnd = nextEnd; }
    else { matched = false; matchStart = INF; matchEnd = -1; }
    hasNext = false; nextStart = INF; nextEnd = -1;
    if (spans.length >= maxMatches) return false;
    if (c.anchoredStart) return false;
    pruneBelowFloor(); // the segment-boundary cost: one slot pass
    return true;
  };

  const cps = Array.from(input);
  const N = cps.length;
  let pos = 0;

  // position 0: the atStart closure
  segments++;
  cur.set(c.initStart.bits);
  steps += words;
  for (let s = 0; s < c.slots; s++) {
    steps++;
    if ((cur[s >> 5]! >>> (s & 31)) & 1) { curStart[s] = 0; curMinStart = 0; }
  }
  if (c.initStart.matched) latch(0, 0);

  while (pos < N) {
    // Finalise BEFORE consuming the next character. The held match is FINAL
    // when no live thread can beat it: every live start is later than its start
    // (the engine's own early-exit test — a fresh start at pos is later still),
    // OR a NEXT-segment candidate already exists (nothing un-emitted can start
    // before a match that is itself clear of the held end). Resume, never stop.
    while (matched && (curMinStart > matchStart || hasNext)) {
      if (!emitAndResume()) { stopped = true; break; }
    }
    if (stopped) break;
    const cp = cps[pos]!.codePointAt(0)!;
    // Fresh unanchored start at EVERY position (pos>0). The single-match engine
    // gates this on `!matched` as an optimisation (a later start can never win
    // there); in a multi-match scan a later start IS the next match, and a
    // thread that completed the held match can legitimately still be live at
    // the same start (leftmost-LONGEST), which would otherwise starve position
    // matchEnd of its fresh start. Seeding always is correct: latch's leftmost
    // rule keeps the held match, and pruneBelowFloor drops overlaps at emission.
    if (pos > 0 && !c.anchoredStart) {
      const im = c.initMid;
      for (let w = 0; w < words; w++) { cur[w] = (cur[w]! | im.bits[w]!) >>> 0; steps++; }
      for (let s = 0; s < c.slots; s++) {
        steps++;
        if ((im.bits[s >> 5]! >>> (s & 31)) & 1 && curStart[s]! > pos) curStart[s] = pos;
      }
      if (im.matched) latch(pos, pos);
    }
    nxt.fill(0); nxtStart.fill(INF);
    let minNext = INF;
    for (let s = 0; s < c.slots; s++) {
      steps++;
      if (!((cur[s >> 5]! >>> (s & 31)) & 1)) continue;
      const instr = c.prog[c.slotToInstr[s]!]!;
      if (instr.op !== "char") continue;
      const rr = inRangesWithCost(cp, instr.ranges);
      steps += rr.comparisons;
      if (!rr.matched) continue;
      const row = c.rows[s]!;
      for (let w = 0; w < words; w++) { nxt[w] = (nxt[w]! | row[w]!) >>> 0; steps++; }
      const st = curStart[s]!;
      for (let t = 0; t < c.slots; t++) {
        steps++;
        if ((row[t >> 5]! >>> (t & 31)) & 1 && nxtStart[t]! > st) nxtStart[t] = st;
      }
      if (st < minNext) minNext = st;
      if (c.matchOnConsume[s]) latch(st, pos + 1);
    }
    let t1 = cur; cur = nxt; nxt = t1;
    let t2 = curStart; curStart = nxtStart; nxtStart = t2;
    curMinStart = minNext;
    pos++;
    // uniformScan has no bearing on findAll's correctness or bound: the flag
    // only ever controlled whether the single-match engine STOPPED early, and a
    // multi-match scan never stops early — it resumes. Accepted for API parity.
    void uniformScan;
  }

  if (stopped) {
    truncated = spans.length >= maxMatches && pos < N;
  } else {
    // end of input: resolve parked eol assertions, then a fresh empty match at end
    for (let s = 0; s < c.slots; s++) {
      steps++;
      if (!((cur[s >> 5]! >>> (s & 31)) & 1)) continue;
      const instr = c.prog[c.slotToInstr[s]!]!;
      if (instr.op === "eol" && c.eolResolves[s]) latch(curStart[s]!, pos);
    }
    // A fresh EMPTY match at the very end (`$`, `a*` tails). It is a candidate
    // like any other — the latch decides whether it is held, queued as NEXT
    // (after a held match that ends before pos), or void.
    if ((pos === 0 || !c.anchoredStart) && c.endFreshMatches[pos === 0 ? 1 : 0]) latch(pos, pos);
    // At the true end everything held is final: drain held, then NEXT (a match
    // clear of the held end that was observed early). Nothing can follow.
    while (matched) {
      if (spans.length >= maxMatches) { truncated = true; break; }
      spans.push([matchStart, matchEnd]);
      segments++;
      const wasEmpty = matchEnd === matchStart;
      floor = wasEmpty ? matchStart : matchEnd;
      noEmptyAt = wasEmpty ? matchStart : -1;
      if (hasNext && nextStart >= floor && !(nextStart === nextEnd && nextStart === noEmptyAt)) {
        matched = true; matchStart = nextStart; matchEnd = nextEnd;
      } else { matched = false; }
      hasNext = false; nextStart = INF; nextEnd = -1;
      // After the drained match, a fresh EMPTY match AT the end may still be
      // legal: it must sit at or after the floor and must not be empty-at-p for
      // the p just emitted as empty (the "advance one" rule — an empty match at
      // pos-1 leaves pos itself free, an empty match AT pos does not repeat).
      if (!matched && !c.anchoredStart && c.endFreshMatches[0] && pos >= floor && pos !== noEmptyAt) {
        matched = true; matchStart = pos; matchEnd = pos;
      }
    }
  }

  // (★) each code point stepped once; each segment start pays one boundary
  // (the pruning pass or the initial closure), plus one for the end resolution.
  const stepsBound = N * certificate.perCharWorkBound + (segments + 1) * certificate.boundaryWorkBound;
  return { spans, truncated, steps, stepsBound, segments, chars: pos };
}
