import * as migration_20261118_030155_foundation from './20261118_030155_foundation';
import * as migration_20261118_041309_import_adapter from './20261118_041309_import_adapter';

export const migrations = [
  {
    up: migration_20261118_030155_foundation.up,
    down: migration_20261118_030155_foundation.down,
    name: '20261118_030155_foundation',
  },
  {
    up: migration_20261118_041309_import_adapter.up,
    down: migration_20261118_041309_import_adapter.down,
    name: '20261118_041309_import_adapter'
  },
];
