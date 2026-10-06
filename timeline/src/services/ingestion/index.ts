/**
 * Web ingestion services (spec Req 7-10): the extractor registry.
 *
 * Exports the extractor contract, the concrete extractors, the HTTP boundary
 * and the orchestrator that feeds the existing import pipeline.
 *
 * SOURCE DISCLOSURE — what is complete and what is not.
 *
 * There is no separate ingestion report file. This comment is the disclosure;
 * it is kept next to the registry so a reader sees it before wiring a source.
 *
 * COMPLETE (works on real input, with the limits named):
 *   - `text` (TextExtractor, pattern path): sentences with a recognised date
 *     become events, offline and deterministic. Recognised forms are ISO,
 *     `Month D, YYYY`, `D Month YYYY`, `Month YYYY`, and a year carrying an
 *     AD/CE suffix; BCE dates are not recognised at all (JavaScript `Date`
 *     cannot round-trip a negative year and `ImportService` would reject the
 *     result). A sentence with no capitalised name produces an event with an
 *     empty actor/target and `selected: false`, so a default approve skips it
 *     instead of failing on it.
 *   - `wikipedia` (WikipediaExtractor): infobox dates and prose dates. Both
 *     date forms real articles use are handled -- plain text (`| date = 14
 *     October 1066`) and date templates (`| birth_date = {{birth
 *     date|df=y|1815|12|10}}`) -- and infobox fields are read whole even when
 *     their value nests templates (`{{Plainlist|...}}`,
 *     `{{Location map many|...}}`) or contains a piped wikilink. Only the field
 *     names in `INFOBOX_DATE_FIELDS` count as dates; an infobox field outside
 *     that list is ignored. Link following keeps only links MediaWiki reports
 *     in the article namespace (`ns: 0`).
 *
 * PARTIAL, with the limits stated:
 *   - `wikidata` (WikidataExtractor): the `historical-events` query returns
 *     dated items that are an instance of `armed conflict` (Q350604) or
 *     `conquest` (Q1361229) or a subclass of either, reading `point in time`
 *     (P585) or `start time` (P580). It is a broad heuristic, not a curated
 *     chronology and not a claim to cover every kind of historical event:
 *     treaties, elections and natural disasters are outside both anchors (use
 *     `custom` for those), results are whatever matches first up to `limit`,
 *     end times (P582) are not read, BCE rows are dropped, and an item with
 *     several `location` (P276) values appears once per place (the recorded
 *     fixture shows the Second Punic War six times). The anchor set is also
 *     bounded by what the query service can answer: `occurrence` (Q1190554),
 *     the common ancestor of both anchors, makes the broad query fail with
 *     HTTP 504, so it is not used.
 *   - `wikipedia` link following: the namespace cannot be filtered server-side
 *     (`action=parse&prop=links` rejects `plnamespace` as unrecognized --
 *     MediaWiki answers "Unrecognized parameter: plnamespace"), so the
 *     client-side `ns` filter is the whole namespace check. The `linkFilter`
 *     regex is user input and passes a heuristic guard against catastrophic
 *     backtracking (`assertSafeLinkFilter`); that guard is a narrowing, not a
 *     proof that every accepted pattern is fast.
 *   - `wikipedia` infobox targets come from `place` or `location` only;
 *     `birth_place`/`death_place` are not used.
 *   - `person-timeline` (WikidataExtractor): only birth (P569) and death (P570)
 *     for one `parameters.person` id.
 *
 * NOT IMPLEMENTED, and not reachable from the API:
 *   - Arcs. No extractor returns an `ExtractedArc`; every extractor returns
 *     `arcs: []`. Arc creation still happens on the normal (non-ingestion)
 *     authoring path. The review/approve plumbing forwards arcs if an extractor
 *     ever produces them, but nothing produces them today.
 *   - `enrichDescription` on the LLM clients. Implemented in the interface and
 *     in both providers, but no production code calls it; only tests do. It is
 *     not exposed on any route. Treat descriptions as the extractor's own text.
 *   - Relationships from any source other than the LLM clients: `TextExtractor`
 *     asks a configured LLM for causal links between the events it just
 *     returned (and drops any link naming an event outside that set). With no
 *     LLM configured, every extraction has zero relationships.
 *
 * The extractor fixtures in `fixtures/` are trimmed recordings of live API
 * responses: the Wikipedia wikitext and link lists are verbatim, and the
 * Wikidata files are verbatim SPARQL result sets (the historical-events one
 * trimmed to its first ten rows).
 */

export * from './types';
export * from './http';
export * from './ids';
export * from './text-patterns';
export * from './TextExtractor';
export * from './WikipediaExtractor';
export * from './WikidataExtractor';
export * from './IngestionOrchestrator';
