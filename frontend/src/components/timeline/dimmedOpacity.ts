/**
 * How much of a mark (its stem, rings and dot) shows while another event's
 * ripple is traced: about a third, so the trace stands out. The mark's label
 * is not faded with it; it takes `--text-muted`, which holds 4.5:1 on the card
 * in both schemes and is clearly lighter than the label at rest
 * (styles/tokens.contrast.test.ts measures both).
 */
export const DIMMED_OPACITY = 0.3
