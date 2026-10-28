#!/usr/bin/env npx ts-node

/**
 * Attribute cloud rows written before #59 to one graph.
 *
 * #59 gave stored cloud data a graph identity. Rows written before it carry no
 * `graphId`, so a graph-scoped read cannot see them; a cloud process reports
 * that at startup (`adoptUnattributedCloudData`) instead of hiding them, and
 * this command is how an operator resolves it.
 *
 * The target graph is always explicit: the CLI never guesses, because a wrong
 * guess would move one graph's history into another. `--dry-run` prints the
 * counts without writing.
 */

import { Command } from 'commander';
import { initializeDatabaseManager, getDatabaseManager } from '../utils/database';
import { loadConfig } from '../utils/config';
import {
  attributeUnattributedData,
  countUnattributedData,
  hasUnattributedData,
  UnattributedDataCounts,
} from '../utils/graphAttribution';

/** Print a counts object in one line. */
function describe(counts: UnattributedDataCounts): string {
  return (
    `${counts.events} event(s), ${counts.arcs} arc(s), ` +
    `${counts.causalRelationships} causal relationship(s)`
  );
}

async function attribute(graphId: string, dryRun: boolean): Promise<void> {
  const config = loadConfig();
  if (config.localExecution.enabled) {
    console.error(
      'Graph attribution applies to cloud storage only. Local mode is already scoped: each graph is a file.'
    );
    process.exitCode = 1;
    return;
  }

  initializeDatabaseManager(config.database);
  await getDatabaseManager().initializeNeo4j();

  const session = getDatabaseManager().getNeo4jSession();
  try {
    const before = await countUnattributedData(session);
    if (!hasUnattributedData(before)) {
      console.log('Nothing to attribute: every stored row already carries a graph identity.');
      return;
    }

    console.log(`Unattributed rows before: ${describe(before)}`);

    if (dryRun) {
      console.log(
        `Dry run: nothing written. Re-run without --dry-run to attribute these rows to "${graphId}".`
      );
      return;
    }

    const outcome = await attributeUnattributedData(session, graphId);
    console.log(`Attributed to "${graphId}": ${describe(outcome.attributed)}`);

    if (hasUnattributedData(outcome.remaining)) {
      console.warn(
        `Still unattributed: ${describe(outcome.remaining)}. These rows do not agree on a graph ` +
          '(for example a causal relationship whose endpoints belong to different graphs), so they ' +
          'need to be inspected before they are attributed.'
      );
      process.exitCode = 2;
      return;
    }

    console.log('Done: every stored row now carries a graph identity.');
  } finally {
    await session.close();
    await getDatabaseManager().close();
  }
}

const program = new Command();

program
  .name('attribute-graph-data')
  .description('Attribute cloud rows written before graph identity existed to one graph')
  .requiredOption('--graph <graphId>', 'graph the unattributed rows belong to')
  .option('--dry-run', 'report the counts without writing anything', false)
  .action(async (options: { graph: string; dryRun: boolean }) => {
    try {
      await attribute(options.graph, options.dryRun);
    } catch (error) {
      console.error('Graph attribution failed:', error);
      process.exitCode = 1;
    }
  });

program.addHelpText(
  'after',
  `

Examples:
  $ npm run migrate:attribute-graph -- --graph <graphId> --dry-run   # report only
  $ npm run migrate:attribute-graph -- --graph <graphId>             # attribute the rows

Configuration:
  Uses the application configuration (Neo4j connection settings) and must run
  with LOCAL_EXECUTION_ENABLED=false.
`
);

program.parse();
