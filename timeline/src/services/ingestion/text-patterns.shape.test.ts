import { describe, it, expect } from 'vitest';
import { extractCapitalizedEntities, shapedConfidence } from './text-patterns';

describe('extractCapitalizedEntities and possessives', () => {
  it("keeps a possessive inside a name, and reads a lone possessive as its owner", () => {
    expect(extractCapitalizedEntities("The Clerks' Union struck against Parliament.")).toContain("Clerks' Union");
    expect(extractCapitalizedEntities("Babbage's design impressed Lovelace.")).toEqual(['Babbage', 'Lovelace']);
  });
});

describe('shapedConfidence', () => {
  it('trusts a table row, a fragment, or a function-word target less than a sentence', () => {
    const sentence = 'Parliament repealed the Engine Licensing Act after the strike.';
    expect(shapedConfidence(0.8, sentence, 'Engine Licensing Act')).toBe(0.8);
    expect(shapedConfidence(0.8, 'Zuse Z3 | May 1941 | Binary floating point | Electro-mechanical', 'Zuse')).toBeLessThan(0.5);
    expect(shapedConfidence(0.8, 'As of May 2016, nothing was built.', 'of May')).toBe(0.6);
    expect(shapedConfidence(0.8, 'The clerks struck.', 'Parliament')).toBe(0.6);
    expect(shapedConfidence(0.2, 'a | b | c', 'of x')).toBe(0.1);
  });
});

import { extractDates } from './text-patterns';

describe('extractDates and bare years', () => {
  it('reads a year after a temporal preposition, at year precision', () => {
    expect(extractDates('In 1862 Parliament repealed the Engine Licensing Act.').map((d) => [d.iso.slice(0, 4), d.precision])).toEqual([['1862', 'year']]);
    expect(extractDates('The school was founded in 1852.').map((d) => d.iso.slice(0, 4))).toEqual(['1852']);
  });

  it('leaves a bare number without a preposition alone, and prefers a fuller date', () => {
    expect(extractDates('Some 1500 clerks marched.')).toEqual([]);
    expect(extractDates('In March 1871 the Admiralty adopted it.').map((d) => d.precision)).toEqual(['month']);
  });
});
