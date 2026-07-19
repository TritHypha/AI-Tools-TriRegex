// =============================================================================
// TriRegex compiler — AST → Thompson NFA → precomputed epsilon-closure rows +
// the cost certificate. All quantifiers are expanded BOUNDED (budget-vetoed),
// so the automaton size — and therefore the per-char work bound — is fixed at
// compile time. No DFA determinization (no state explosion), no backtracking.
//
// Resting states = char instrs + eol instrs (a thread only ever "waits" at a
// char to consume, or at an eol to be resolved at end-of-input). For each char
// resting state we precompute the epsilon-closure row of resting states reached
// after consuming — the hot loop is then pure bitset unions with a hard bound.
// Contact hello@trithypha.dev · Apache-2.0.
// =============================================================================
import type { AstNode, Budget, CompileVeto, CostCertificate, Instr, Ranges } from "./types.ts";

class VetoError extends Error {
  readonly v: CompileVeto;
  constructor(v: CompileVeto) { super(v.reason); this.v = v; }
}
const budgetVeto = (reason: string): VetoError =>
  new VetoError({ ok: false, verdict: -1, code: "TPRX-BUDGET", reason });

// ── Thompson emission (sequential, fallthrough continuation) ─────────────────
class Emitter {
  prog: Instr[] = [];
  private readonly budget: Budget;
  constructor(budget: Budget) { this.budget = budget; }

  private push(i: Instr): number {
    this.prog.push(i);
    if (this.prog.length > this.budget.maxInstructions)
      throw budgetVeto(`expanded automaton exceeds budget.maxInstructions (${this.budget.maxInstructions}) — pattern refused, not run slowly`);
    return this.prog.length - 1;
  }

  emit(n: AstNode): void {
    switch (n.kind) {
      case "empty": return;
      case "bol": this.push({ op: "bol" }); return;
      case "eol": this.push({ op: "eol" }); return;
      case "any": this.push({ op: "char", ranges: [[0x00, 0x09], [0x0b, 0x10ffff]] }); return; // all but \n
      case "class": this.push({ op: "char", ranges: n.ranges }); return;
      case "concat": for (const c of n.items) this.emit(c); return;
      case "alt": this.emitAlt(n.items); return;
      case "rep": this.emitRep(n); return;
    }
  }

  private emitAlt(items: AstNode[]): void {
    if (items.length === 0) return;
    if (items.length === 1) { this.emit(items[0]!); return; }
    const [head, ...rest] = items;
    const s = this.push({ op: "split", x: -1, y: -1 });
    (this.prog[s] as { x: number }).x = this.prog.length;
    this.emit(head!);
    const j = this.push({ op: "jmp", x: -1 });
    (this.prog[s] as { y: number }).y = this.prog.length;
    this.emitAlt(rest);
    (this.prog[j] as { x: number }).x = this.prog.length;
  }

  private emitRep(n: { item: AstNode; min: number; max: number }): void {
    const { item, min, max } = n;
    for (let k = 0; k < min; k++) this.emit(item);
    if (max === Infinity) {
      // star: S: split(body, out); body; jmp S; out:
      const s = this.push({ op: "split", x: -1, y: -1 });
      (this.prog[s] as { x: number }).x = this.prog.length;
      this.emit(item);
      this.push({ op: "jmp", x: s });
      (this.prog[s] as { y: number }).y = this.prog.length;
      return;
    }
    // finite tail: (max-min) optionals — language-equivalent flat expansion
    for (let k = min; k < max; k++) {
      const s = this.push({ op: "split", x: -1, y: -1 });
      (this.prog[s] as { x: number }).x = this.prog.length;
      this.emit(item);
      (this.prog[s] as { y: number }).y = this.prog.length;
    }
  }
}

// ── closure machinery ────────────────────────────────────────────────────────
export interface Closure {
  /** bitset over resting slots */
  bits: Uint32Array;
  matched: boolean;
}

export interface Compiled {
  prog: Instr[];
  /** resting-slot maps */
  slotToInstr: Int32Array;
  instrToSlot: Int32Array;
  slots: number;
  words: number;
  /** per char-slot: closure row after consuming (bits over slots) */
  rows: Uint32Array[]; // rows[slot] — zero-length array for eol slots
  /** per char-slot: consuming reaches MATCH */
  matchOnConsume: Uint8Array;
  /** closure from instr 0 at position 0 (atStart) */
  initStart: Closure;
  /** closure from instr 0 mid-input (fresh unanchored start) */
  initMid: Closure;
  anchoredStart: boolean;
  certificate: CostCertificate;
  /** resolve an eol resting slot at end-of-input → does it reach MATCH? */
  eolResolves: (slot: number) => boolean;
  /** a fresh start AT end-of-input (empty-suffix match), len==0 ⇒ atStart */
  endFreshMatches: (atStart: boolean) => boolean;
}

export function compileAst(ast: AstNode, budget: Budget, patternLength: number): Compiled | CompileVeto {
  const em = new Emitter(budget);
  try {
    em.emit(ast);
    em.prog.push({ op: "match" });
  } catch (e) {
    if (e instanceof VetoError) return e.v;
    throw e;
  }
  const prog = em.prog;
  const n = prog.length;

  // resting slots: char + eol
  const instrToSlot = new Int32Array(n).fill(-1);
  const slotList: number[] = [];
  for (let i = 0; i < n; i++) {
    const op = prog[i]!.op;
    if (op === "char" || op === "eol") { instrToSlot[i] = slotList.length; slotList.push(i); }
  }
  const slotToInstr = Int32Array.from(slotList);
  const slots = slotList.length;
  const words = Math.max(1, Math.ceil(slots / 32));

  /** epsilon walk. parkEol: treat eol as a resting stop (runtime-mid semantics). */
  function walk(from: number[], atStart: boolean, atEnd: boolean, parkEol: boolean): Closure {
    const bits = new Uint32Array(words);
    let matched = false;
    const visited = new Uint8Array(n);
    const stack = [...from];
    while (stack.length) {
      const i = stack.pop()!;
      if (i < 0 || i >= n || visited[i]) continue;
      visited[i] = 1;
      const ins = prog[i]!;
      switch (ins.op) {
        case "char": bits[instrToSlot[i]! >> 5] = (bits[instrToSlot[i]! >> 5]! | (1 << (instrToSlot[i]! & 31))) >>> 0; break;
        case "eol":
          if (parkEol) bits[instrToSlot[i]! >> 5] = (bits[instrToSlot[i]! >> 5]! | (1 << (instrToSlot[i]! & 31))) >>> 0;
          else if (atEnd) stack.push(i + 1);
          break;
        case "bol": if (atStart) stack.push(i + 1); break;
        case "split": stack.push(ins.x, ins.y); break;
        case "jmp": stack.push(ins.x); break;
        case "match": matched = true; break;
      }
    }
    return { bits, matched };
  }

  const rows: Uint32Array[] = new Array(slots);
  const matchOnConsume = new Uint8Array(slots);
  for (let s = 0; s < slots; s++) {
    const i = slotToInstr[s]!;
    if (prog[i]!.op === "char") {
      const c = walk([i + 1], false, false, true);
      rows[s] = c.bits;
      matchOnConsume[s] = c.matched ? 1 : 0;
    } else rows[s] = new Uint32Array(0); // eol slot — resolved at end()
  }

  const initStart = walk([0], true, false, true);
  const initMid = walk([0], false, false, true);
  const anchoredStart = !initMid.matched && initMid.bits.every((w) => w === 0);

  const eolMemo = new Map<number, boolean>();
  const eolResolves = (slot: number): boolean => {
    const hit = eolMemo.get(slot);
    if (hit !== undefined) return hit;
    const r = walk([slotToInstr[slot]! + 1], false, true, false).matched;
    eolMemo.set(slot, r);
    return r;
  };
  const endFreshMatches = (atStart: boolean): boolean => walk([0], atStart, true, false).matched;

  const certificate: CostCertificate = {
    instructions: n,
    restingStates: slots,
    // per char worst case: slots iteration visits (1 step each) + per matching
    // slot a row-union + start-scan (2·words each) + the fresh-start union
    // (2·words) — (2w+1)(s+1) = 2ws + s + 2w + 1 dominates every term.
    perCharWorkBound: (2 * words + 1) * (slots + 1),
    memoryBoundBytes: slots * words * 4 + n * 24 + words * 8 + slots * 8,
    patternLength,
    anchoredStart,
  };

  return {
    prog, slotToInstr, instrToSlot, slots, words, rows, matchOnConsume,
    initStart, initMid, anchoredStart, certificate, eolResolves, endFreshMatches,
  };
}

export function inRanges(cp: number, ranges: Ranges): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return true;
  }
  return false;
}
