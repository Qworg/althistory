/**
 * Merging the two ways of reading a text.
 *
 * The CLI's `hybrid` ingestion mode reads a text twice: once with the
 * deterministic pattern extractor, which always works, and once with the
 * language model, which reads more but sometimes fails. The union of the two
 * is what the mode promises, so this merges them.
 *
 * The events are matched by what they describe, not by the exact strings they
 * carry. A model that paraphrases the sentence the patterns read has still
 * found the same event, and the two readings of it have to become one event
 * rather than two: the graph would otherwise hold a model copy and a pattern
 * copy of every event the text mentions. The copy with the higher confidence
 * wins.
 *
 * The wording alone is a poor test for that, because the model is asked for a
 * concise description and the patterns quote the whole sentence. The match is
 * made on the event itself: the date it happened, and the words that say who
 * did what. Two readings of one event share the words of the event even when
 * they share little of the sentence around them.
 *
 * The relationships are not merged across the two results: they name the
 * events by their temporary ids, and the two results use different ones, so a
 * merged relationship could name an event that is not in the merged set. The
 * model's relationships are kept, because the pattern path produces none,
 * and the ids they name are rewritten when a matched event is won by the
 * pattern copy.
 */

import { ExtractedEvent, ExtractionResult } from './types';

/**
 * How far apart two readings of one event may be.
 *
 * A month is enough for a model that names the month of a date the patterns
 * read as a day, and short enough that two different events are not read as
 * one.
 */
const MATCH_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

/** How alike two descriptions have to be to be the same event. */
const SAME_EVENT_SIMILARITY = 0.75;

/** How much of the shorter description the longer one has to cover. */
const SAME_EVENT_COVERAGE = 0.6;

/**
 * How much of the shorter description the longer one has to cover when the
 * two readings name the same actor and the same target.
 */
const RELATED_COVERAGE = 0.5;

/**
 * The words that say nothing about the event.
 *
 * They are dropped before the two readings are compared, because a model
 * writes "The Congress adopted..." where the patterns quote "On 4 July 1776,
 * the Continental Congress adopted...", and the words around the event are
 * not the event.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'she', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to',
  'was', 'were', 'when', 'which', 'while', 'who', 'whom', 'whose', 'with',
  'would', 'could', 'shall', 'should', 'will', 'also', 'after', 'before',
  'during', 'over', 'under', 'about', 'than', 'then', 'thus', 'such',
]);

/**
 * The words that are part of a date rather than of the event.
 *
 * The two readings may name the date differently -- one of them reads the
 * day, the other the month -- and the date is compared on its own.
 */
const DATE_WORDS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'ad', 'ce', 'bc',
  'bce',
]);

/** Lowercase a text and drop everything that is not a word or a number. */
function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The stem of a word.
 *
 * The model writes "adopted" where the sentence says "adoption", and the two
 * are the same word for the purpose of this comparison. The rules are the
 * usual English ones, applied to the longest ending first.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  for (const ending of ['ations', 'ation', 'ings', 'ies', 'ing', 'ed', 'es', 's']) {
    if (!word.endsWith(ending)) continue;
    if (ending === 's' && word.endsWith('ss')) continue;
    const shortened = word.slice(0, word.length - ending.length);
    if (ending === 'ies') return `${shortened}y`;
    if (shortened.length < 3) continue;
    return shortened;
  }
  return word;
}

/**
 * The words of a text that say something about the event.
 *
 * The words of the stop list are dropped, the words of a date are dropped --
 * the date is compared on its own -- and the rest are stemmed, so that the
 * two wordings of one word are one word.
 */
function contentWords(value: string): Set<string> {
  const words = new Set<string>();
  for (const word of normalizeText(value).split(' ')) {
    if (word === '') continue;
    if (STOP_WORDS.has(word)) continue;
    if (DATE_WORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    words.add(stem(word));
  }
  return words;
}

/**
 * The words of an event that say what happened.
 *
 * The description is the event, and the actor and the target are the two
 * ends of it: a model that names them in fields the sentence does not spell
 * out has still said what the event was about.
 */
function evidenceWords(event: ExtractedEvent): Set<string> {
  const words = contentWords(event.description);
  for (const word of contentWords(event.actor)) words.add(word);
  for (const word of contentWords(event.target)) words.add(word);
  return words;
}

/**
 * How alike two sets of words are.
 *
 * The score is the Dice coefficient: twice the words the two have in common,
 * over the number of words they have between them.
 */
function similarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of left) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  let shared = 0;
  for (const word of right) {
    const count = counts.get(word);
    if (count !== undefined && count > 0) {
      shared++;
      counts.set(word, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/** Whether two texts name the same thing. */
function sameText(left: string, right: string): boolean {
  const normalizedLeft = normalizeText(left);
  return normalizedLeft !== '' && normalizedLeft === normalizeText(right);
}

/**
 * Whether two extractions describe the same event.
 *
 * They do when they are close enough in time and describe it in much the same
 * words. The wording carries the decision, because a model paraphrases a
 * sentence and the patterns quote it; the actor and the target only make a
 * weaker match acceptable.
 *
 * The words that count are the ones that say what happened: the words of the
 * two descriptions, and the words of the actor and the target when the other
 * description says them too. A word that only the actor and the target
 * fields have in common is not evidence, because the pattern path takes its
 * actor and its target out of the sentence -- two events with the same actor
 * and the same target but different sentences are still two events.
 */
export function describesSameEvent(left: ExtractedEvent, right: ExtractedEvent): boolean {
  const leftWords = contentWords(left.description);
  const rightWords = contentWords(right.description);
  const leftEvidence = evidenceWords(left);
  const rightEvidence = evidenceWords(right);

  // The words the two events have in common, and the ones that at least one
  // of the two descriptions actually says. A word that only the actor and
  // the target fields have in common is not evidence: the pattern path
  // takes its actor and its target out of the sentence, so two events with
  // the same actor and target but different sentences are still two events.
  const shared = [...leftEvidence].filter((word) => rightEvidence.has(word));
  const described = new Set([...leftWords, ...rightWords]);
  const sharedDescribed = shared.filter((word) => described.has(word));

  const dice = similarity([...leftWords], [...rightWords]);
  const shorter = Math.max(1, Math.min(leftWords.size, rightWords.size));
  const covered = Math.min(1, sharedDescribed.length / shorter);
  const sharesActor = sameText(left.actor, right.actor);
  const sharesTarget = sameText(left.target, right.target);

  const alike =
    dice >= SAME_EVENT_SIMILARITY ||
    (covered >= SAME_EVENT_COVERAGE && sharedDescribed.length >= 2) ||
    (sharesActor && sharesTarget && covered >= RELATED_COVERAGE && sharedDescribed.length >= 1);
  if (!alike) return false;

  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    // One of the two has no usable time, so the wording is the only evidence.
    return true;
  }
  return Math.abs(leftTime - rightTime) <= MATCH_WINDOW_MS;
}

/**
 * Merge a pattern extraction and a model extraction into one result.
 */
export function mergeExtractionResults(
  patternResult: ExtractionResult,
  llmResult: ExtractionResult | null
): ExtractionResult {
  if (!llmResult) return patternResult;

  // The model's events come first, so the merged result follows the order of
  // the model and the patterns add to it.
  const events: ExtractedEvent[] = [...llmResult.events];
  // The id every event of the model is known by in the merged result. It
  // changes when the pattern copy of an event wins, so that the
  // relationships the model proposed still name the right event.
  const mergedIdByModelId = new Map<string, string>();
  for (const event of llmResult.events) {
    mergedIdByModelId.set(event.tempId, event.tempId);
  }

  for (const patternEvent of patternResult.events) {
    // A pattern event is only matched against the events of the model: two
    // sentences of the patterns are two sentences, and the patterns have
    // already dropped the duplicates of their own.
    const matchIndex = llmResult.events.findIndex((event) =>
      describesSameEvent(patternEvent, event)
    );
    if (matchIndex < 0) {
      events.push(patternEvent);
      continue;
    }
    const modelEvent = llmResult.events[matchIndex];
    const existing = events[matchIndex];
    if (patternEvent.confidence > existing.confidence) {
      events[matchIndex] = patternEvent;
      // The name of the model event now belongs to the pattern copy, so the
      // relationships that name it name the event that is really there.
      mergedIdByModelId.set(modelEvent.tempId, patternEvent.tempId);
    }
  }

  const knownIds = new Set(events.map((event) => event.tempId));
  const relationships = llmResult.relationships
    .map((relationship) => {
      const cause = mergedIdByModelId.get(relationship.causeEventTempId) ?? relationship.causeEventTempId;
      const effect = mergedIdByModelId.get(relationship.effectEventTempId) ?? relationship.effectEventTempId;
      if (cause === relationship.causeEventTempId && effect === relationship.effectEventTempId) {
        return relationship;
      }
      return { ...relationship, causeEventTempId: cause, effectEventTempId: effect };
    })
    // A relationship that names an event the merged result does not hold is
    // dropped: it would be a link to nothing.
    .filter(
      (relationship) =>
        knownIds.has(relationship.causeEventTempId) && knownIds.has(relationship.effectEventTempId)
    );

  const totalConfidence = events.reduce((sum, event) => sum + event.confidence, 0);

  return {
    events,
    arcs: [...llmResult.arcs, ...patternResult.arcs],
    relationships,
    sources: [...llmResult.sources, ...patternResult.sources],
    overallConfidence: events.length === 0 ? 0 : totalConfidence / events.length,
  };
}
