import { databaseCases as regressions } from './boundary-database-cases.mjs';
import { databaseCases as generated, generation } from './silent-discovery-cases.mjs';
import { databaseCases as holdout, generation as holdoutGeneration } from './semantic-holdout-cases.mjs';
import { databaseCases as padding } from './padding-database-cases.mjs';
import { databaseCases as comments } from './comment-database-cases.mjs';
export { generation };
export { holdoutGeneration };
export const databaseCases = [...regressions, ...generated, ...holdout, ...padding, ...comments].map((fixture) => ({ ...fixture, compareColumnTypes: true }));
