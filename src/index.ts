// =============================================================================
// TriRegex — ternary streaming pattern matching, ReDoS-immune by construction.
// Public API. Provenance: dp-rd-0459 (defensive publication).
// Contact hello@trithypha.dev · Apache-2.0.
// =============================================================================
import { compileAst } from "./compile.ts";
import { parsePattern } from "./parser.ts";
import { TriMatcher } from "./engine.ts";
import type { Budget, CompileVeto, CostCertificate } from "./types.ts";
import { DEFAULT_BUDGET } from "./types.ts";

export const VERSION = "0.1.0";

export {
  MATCH, INDETERMINATE, SECURITY_VETO, DEFAULT_BUDGET,
} from "./types.ts";
export type {
  TriVerdict, Budget, CostCertificate, CompileVeto, EngineStats, MatchOutcome,
} from "./types.ts";
export type { TriStream } from "./engine.ts";
export { TriMatcher } from "./engine.ts";

export interface CompileOptions {
  budget?: Partial<Budget>;
  /**
   * Disable the early exit after a latched match (every character is still
   * scanned). v0.1 HONESTY: this reduces data-dependent control flow; it is
   * NOT a constant-time guarantee (JS/JIT gives none) and the active-set size
   * still varies with content. A dense fixed-shape scan is a declared v0.2.
   */
  uniformScan?: boolean;
}

export interface CompileOk {
  ok: true;
  certificate: CostCertificate;
  matcher: TriMatcher;
}

/**
 * Compile a pattern. NEVER throws on pattern content — an unsupported or
 * over-budget pattern returns a SECURITY_VETO refusal ({ok:false, verdict:-1})
 * so the caller's fail-closed path is a value check, not exception handling.
 */
export function compile(pattern: string, opts: CompileOptions = {}): CompileOk | CompileVeto {
  const budget: Budget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };
  const parsed = parsePattern(pattern, budget);
  if (!parsed.ok) return parsed;
  const compiled = compileAst(parsed.ast, budget, pattern.length);
  if ("ok" in compiled) return compiled;
  return {
    ok: true,
    certificate: compiled.certificate,
    matcher: new TriMatcher(compiled, opts.uniformScan === true),
  };
}
