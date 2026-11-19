import * as migration_20261118_030155_foundation from './20261118_030155_foundation';
import * as migration_20261118_041309_import_adapter from './20261118_041309_import_adapter';
import * as migration_20261118_091607_processing_review from './20261118_091607_processing_review';
import * as migration_20261118_092849_review_receipt from './20261118_092849_review_receipt';
import * as migration_20261118_190233_admin_usability from './20261118_190233_admin_usability';
import * as migration_20261118_234658_review_windows_and_sections from './20261118_234658_review_windows_and_sections';
import * as migration_20261119_011841_library_pages from './20261119_011841_library_pages';
import * as migration_20261119_030446_original_dates from './20261119_030446_original_dates';
import * as migration_20261119_031820_file_names_and_videos from './20261119_031820_file_names_and_videos';
import * as migration_20261119_040000_search_and_evidence from './20261119_040000_search_and_evidence';
import * as migration_20261119_051724_migration_autopilot from './20261119_051724_migration_autopilot';
import * as migration_20261119_200000_vimeo_embeds from './20261119_200000_vimeo_embeds';

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
    name: '20261118_190233_admin_usability',
  },
  {
    up: migration_20261118_234658_review_windows_and_sections.up,
    down: migration_20261118_234658_review_windows_and_sections.down,
    name: '20261118_234658_review_windows_and_sections',
  },
  {
    up: migration_20261119_011841_library_pages.up,
    down: migration_20261119_011841_library_pages.down,
    name: '20261119_011841_library_pages',
  },
  {
    up: migration_20261119_030446_original_dates.up,
    down: migration_20261119_030446_original_dates.down,
    name: '20261119_030446_original_dates',
  },
  {
    up: migration_20261119_031820_file_names_and_videos.up,
    down: migration_20261119_031820_file_names_and_videos.down,
    name: '20261119_031820_file_names_and_videos',
  },
  {
    up: migration_20261119_040000_search_and_evidence.up,
    down: migration_20261119_040000_search_and_evidence.down,
    name: '20261119_040000_search_and_evidence',
  },
  {
    up: migration_20261119_051724_migration_autopilot.up,
    down: migration_20261119_051724_migration_autopilot.down,
    name: '20261119_051724_migration_autopilot'
  },
  {
    up: migration_20261119_200000_vimeo_embeds.up,
    down: migration_20261119_200000_vimeo_embeds.down,
    name: '20261119_200000_vimeo_embeds',
  },
];
