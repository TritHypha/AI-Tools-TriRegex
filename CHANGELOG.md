# Changelog

## 0.1.1 — 2026-07-28

### Security

- Runtime-validates every budget field so `NaN`, infinity, fractions,
  `undefined`, and invalid negative values cannot disable compiler bounds.
- Counts the terminal MATCH instruction against `maxInstructions`.
- Refuses stacked, lazy and possessive quantifier spellings instead of silently
  changing their language.
- Refuses `feed()` after `end()` so unchecked suffix data cannot cross a closed
  stream boundary; repeated `end()` is stable.

### Assurance

- Extended the cost certificate to include class-range comparisons,
  leftmost-start propagation and one-off boundary work.
- Precomputes EOL and fresh-end reachability; `end()` performs no hidden epsilon
  graph walk.
- Added deterministic supported-subset membership differential tests against
  native Unicode `RegExp`.
- Expanded the suite from 28 to 34 tests.

### Integration

- Recorded that certified `findAll`, smart-case, word boundaries and span-unit
  alignment remain required before TriRegex can replace Myco's regex backend.

## 0.1.0 — 2026-07-19

- Initial non-backtracking streaming matcher and compile-time cost certificate.
