// =============================================================================
// TriRegex — types, verdicts, budgets, certificate.
// Ternary verdict vocabulary (Kleene K3 discipline):
//   +1 MATCH        — a match is proven.
//    0 INDETERMINATE — streaming only: not yet decidable; MUST collapse at the
//                      boundary (end-of-stream) — never acted on as "good enough".
//   -1 SECURITY_VETO / NO_MATCH — refused (compile) or proven absent (run).
// Contact hello@trithypha.dev · Apache-2.0.
// =============================================================================

export type TriVerdict = -1 | 0 | 1;
export const MATCH: TriVerdict = 1;
export const INDETERMINATE: TriVerdict = 0;
export const SECURITY_VETO: TriVerdict = -1;

/** Compile-time resource budget. Exceeding any bound is a VETO, never a slow run. */
export interface Budget {
  /** Max NFA instructions after quantifier expansion (the state bound). */
  maxInstructions: number;
  /** Max source pattern length in code units. */
  maxPatternLength: number;
  /** Max finite repetition bound in {n}, {n,m} (mirrors the myco guard's cap). */
  maxRepetition: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxInstructions: 4096,
  maxPatternLength: 4096,
  maxRepetition: 1000,
};

/** The certificate: the bounds a consumer can check BEFORE running the matcher. */
export interface CostCertificate {
  /** NFA instruction count (the automaton size). */
  instructions: number;
  /** Resting states (char/eol) — the active-set upper bound. */
  restingStates: number;
  /**
   * Hard per-character work bound, in bitset word operations:
   * one row-union per active resting state per char — activeMax × rowWords.
   * Actual measured work is exposed by stats() and test-asserted ≤ this bound.
   */
  perCharWorkBound: number;
  /** Approximate resident memory for the closure rows + state arrays, bytes. */
  memoryBoundBytes: number;
  /** Pattern length compiled. */
  patternLength: number;
  /** True when the pattern is start-anchored (no fresh starts mid-stream). */
  anchoredStart: boolean;
}

export interface CompileVeto {
  ok: false;
  verdict: -1;
  /** Machine-usable refusal class. */
  code:
    | "TPRX-PARSE"        // malformed pattern
    | "TPRX-UNSUPPORTED"  // construct refused BY DESIGN (backref, lookaround, …)
    | "TPRX-BUDGET";      // certificate would exceed the budget
  reason: string;
  /** Offset in the pattern where the refusal fired, when known. */
  at?: number;
}

// ── AST ──────────────────────────────────────────────────────────────────────
/** Sorted, disjoint, inclusive code-point ranges. */
export type Ranges = ReadonlyArray<readonly [number, number]>;

export type AstNode =
  | { kind: "class"; ranges: Ranges }               // literal chars are 1-range classes
  | { kind: "any" }                                  // '.' — any cp except \n
  | { kind: "concat"; items: AstNode[] }
  | { kind: "alt"; items: AstNode[] }
  | { kind: "rep"; item: AstNode; min: number; max: number } // max: Infinity allowed
  | { kind: "bol" }
  | { kind: "eol" }
  | { kind: "empty" };

// ── NFA program ──────────────────────────────────────────────────────────────
export type Instr =
  | { op: "char"; ranges: Ranges }
  | { op: "split"; x: number; y: number }
  | { op: "jmp"; x: number }
  | { op: "bol" }
  | { op: "eol" }
  | { op: "match" };

export interface EngineStats {
  /** Code points consumed. */
  chars: number;
  /** Bitset word operations performed (the certified unit of work). */
  steps: number;
  /** Peak active resting-state count observed. */
  maxActive: number;
}

export interface MatchOutcome {
  verdict: -1 | 1;
  /** Leftmost-earliest first-completion span [start, end) in code POINTS, when matched. */
  span?: readonly [number, number];
}
