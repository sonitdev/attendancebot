import { Prisma } from '@prisma/client';
import { timeStep } from './request-timing.js';

/**
 * Times the Prisma operation, including client/pool/transfer overhead, not just SQL execution.
 * query(args) retains Prisma's lazy promise and transaction binding. Do not call the root
 * client here: that would escape interactive transactions. Do not wrap model methods in
 * ordinary async functions: array transactions require the original PrismaPromise.
 * Only aggregate durations/counts/errors are retained, never SQL, args, results or errors.
 */
export const prismaQueryTiming = Prisma.defineExtension({
  name: 'request-query-timing',
  query: {
    $allOperations({ args, query }) {
      return timeStep('db', () => query(args));
    },
  },
});
