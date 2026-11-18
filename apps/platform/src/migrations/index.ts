import * as migration_20261118_030155_foundation from './20261118_030155_foundation';
import * as migration_20261118_041309_import_adapter from './20261118_041309_import_adapter';
import * as migration_20261118_091607_processing_review from './20261118_091607_processing_review';
import * as migration_20261118_092849_review_receipt from './20261118_092849_review_receipt';
import * as migration_20261118_190233_admin_usability from './20261118_190233_admin_usability';

export const migrations = [
  {
    up: migration_20261118_030155_foundation.up,
    down: migration_20261118_030155_foundation.down,
    name: '20261118_030155_foundation',
  },
  {
    up: migration_20261118_041309_import_adapter.up,
    down: migration_20261118_041309_import_adapter.down,
    name: '20261118_041309_import_adapter',
  },
  {
    up: migration_20261118_091607_processing_review.up,
    down: migration_20261118_091607_processing_review.down,
    name: '20261118_091607_processing_review',
  },
  {
    up: migration_20261118_092849_review_receipt.up,
    down: migration_20261118_092849_review_receipt.down,
    name: '20261118_092849_review_receipt',
  },
  {
    up: migration_20261118_190233_admin_usability.up,
    down: migration_20261118_190233_admin_usability.down,
    name: '20261118_190233_admin_usability'
  },
];
