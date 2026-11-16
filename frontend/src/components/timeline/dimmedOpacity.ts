/**
 * How much of a mark and its label shows while another event's ripple is
 * traced. At 0.66 the secondary ink still measures 3:1 or more on the card in
 * both schemes (0.28 gave 1.6:1 in light, 2.1:1 in dark), and a dimmed label
 * is still clearly fainter than one at rest (about 7:1).
 * styles/tokens.contrast.test.ts measures it against the stylesheet's tokens.
 */
export const DIMMED_OPACITY = 0.66
