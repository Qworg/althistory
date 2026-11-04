import { describe, it, expect } from 'vitest';
import { stripLeadingDate } from './text-patterns';

describe('stripLeadingDate', () => {
  it('drops a leading "On <date>," clause and capitalises what remains', () => {
    expect(stripLeadingDate('On 14 February 1870, the clerks struck across London.', '14 February 1870')).toBe(
      'The clerks struck across London.'
    );
  });

  it('drops a bare leading year and an "In <year>" clause', () => {
    expect(stripLeadingDate('In 1843, Babbage completed the Analytical Engine.', '1843')).toBe(
      'Babbage completed the Analytical Engine.'
    );
    expect(stripLeadingDate('1851: the census was tabulated by engine.', '1851')).toBe('1851: the census was tabulated by engine.');
  });

  it('leaves a date that is not at the start, or a remainder too short to stand alone', () => {
    expect(stripLeadingDate('Parliament acted on 3 May 1860.', '3 May 1860')).toBe('Parliament acted on 3 May 1860.');
    expect(stripLeadingDate('In 1843, war.', '1843')).toBe('In 1843, war.');
  });
});
