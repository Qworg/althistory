import type { GenerationRunHooks } from '../engine/IEngine';
import { logger } from './logger';

/**
 * What a `generate` command asks of its run: progress on stderr (stdout stays
 * the JSON result), and Ctrl-C asks the run to stop before its next write
 * instead of killing the process mid-write. A second Ctrl-C ends the process.
 *
 * Call `dispose` when the command is done, so the handler does not outlive it.
 */
export function cliGenerationHooks(): { hooks: GenerationRunHooks; dispose: () => void } {
  const controller = new AbortController();
  const onInterrupt = (): void => {
    logger.info('Stopping before the next write; what was written stays. Press Ctrl-C again to quit now.');
    controller.abort();
  };
  process.once('SIGINT', onInterrupt);

  let last = '';
  return {
    hooks: {
      signal: controller.signal,
      onProgress: (progress) => {
        const line = `${progress.message} (${progress.progress}%)`;
        if (line === last) return;
        last = line;
        logger.info(line);
      },
    },
    dispose: () => {
      process.removeListener('SIGINT', onInterrupt);
    },
  };
}
