"""Synthetic importer tests. Never opens the real backup or makes network calls."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import build_wordpress_import as imp


def record(identity='1', formats=None):
    return {'source_id': identity, 'post_type': 'post', 'status': 'publish', 'title': 'Synthetic article ' + identity,
            'slug': 'synthetic-' + identity, 'source_guid_not_canonical_url': 'https://example.test/?p=' + identity,
            'modified_local': '2026-11-01 12:00:00', 'published_local': '2026-10-01 12:00:00',
            'cohort': 'published_past_year', 'active_candidate': True,
            'descriptions': {'post_excerpt': 'Synthetic description'}, 'taxonomy': [],
            'package_and_category_roles': ['synthetic-role'], 'access_resolution': 'restricted_intake_pending_policy_mapping',
            'download_rule': '1', 'vimeo': [], 'assets': [], 'linked_package_ids': [], 'attachment_ids': [],
            'formats': formats or ['article'], 'flags': []}


def snapshot(r):
    post = {key: '' for key in imp.POST_COLUMNS}
    post.update(ID=r['source_id'], post_type=r['post_type'], post_status=r['status'], post_title=r['title'],
                post_modified=r['modified_local'], post_parent='0', post_author='42',
                post_content='<p>Evidence text</p><script>alert("not run")</script>')
    return {'post': post, 'metadata': [{'meta_id': '1', 'meta_key': 'notes', 'meta_value': 'Synthetic note'}]}


def package(records=None, verified=None, attachments=None):
    records = records or [record()]
    return imp.build_package([(r, 'synthetic') for r in records], {r['source_id']: snapshot(r) for r in records},
                             attachments or {}, verified or {}, {'synthetic': True}, [])


class PackageMappingTests(unittest.TestCase):
    def test_restricted_seed_even_if_source_published_or_private(self):
        for status in ('publish', 'private'):
            r = record(); r['status'] = status
            p = package([r]); seed = p['content'][0]['initialContent']
            self.assertEqual(seed['state'], 'intake')
            self.assertIsNone(seed['accessProfile'])
            self.assertEqual(seed['acceptedTags'], [])
            self.assertEqual(seed['passages'], [])
            self.assertNotIn('alert', seed['body'])
            self.assertIn('alert', p['sourceSnapshots'][0]['snapshot']['raw']['post']['post_content'])

    def test_distinct_records_keep_shared_blob_relationships(self):
        a, b = record('1', ['pdf']), record('2', ['pdf', 'vimeo'])
        local = 'wp-content/uploads/shared.pdf'
        for r in (a, b):
            r['assets'] = [{'field': 'attachment:9', 'reference': 'shared.pdf', 'path': local, 'status': 'present', 'format': 'pdf', 'bytes': 8}]
            r['attachment_ids'] = ['9']
        b['vimeo'] = [{'id': '123', 'fields': ['embed_code']}, {'id': '456', 'fields': ['post_content']}]
        b['linked_package_ids'] = ['1', '999']
        p = package([a, b], {local: {'sha256': 'a' * 64, 'bytes': 8}}, {'9': {'source_id': '9', 'path': local, 'parent_id': '1'}})
        self.assertEqual(len(p['blobs']), 1)
        self.assertEqual(len(p['content']), 2)
        self.assertEqual(len([e for e in p['relationships'] if e['kind'] == 'asset']), 2)
        self.assertEqual(len(p['providerAssets']), 2)
        self.assertNotIn('vimeoId', p['content'][1]['initialContent'])
        links = [e for e in p['relationships'] if e['kind'] == 'linked-package']
        self.assertEqual({e['status'] for e in links}, {'in_package', 'outside_package'})

    def test_source_taxonomy_is_not_accepted_and_preserves_namespace(self):
        r = record()
        r['taxonomy'] = [{'object_id': '1', 'term_id': '10', 'name': 'Synthetic', 'slug': 'synthetic', 'taxonomy': t, 'parent': '0'} for t in ('category', 'post_tag')]
        p = package([r])
        self.assertEqual(len(p['sourceTaxonomy']), 2)
        self.assertEqual(p['content'][0]['initialContent']['acceptedTags'], [])

    def test_relationship_only_change_revises_snapshot(self):
        r = record(); before = package([r])
        r['linked_package_ids'] = ['999']
        after = package([r])
        self.assertNotEqual(before['content'][0]['sourceHash'], after['content'][0]['sourceHash'])

    def test_set_order_does_not_revise_snapshot(self):
        r = record(); r['linked_package_ids'] = ['999', '2']; r['flags'] = ['b', 'a']
        before = package([r])
        r['linked_package_ids'].reverse(); r['flags'].reverse()
        self.assertEqual(before, package([r]))

    def test_builder_and_missing_description_are_explicit(self):
        r = record(); r['flags'] = ['builder_content']; r['descriptions'] = {}
        p = package([r]); item = p['content'][0]
        self.assertIn('builder_rendering_not_reconstructed', item['issues'])
        self.assertIn('description_missing', item['issues'])
        self.assertEqual(item['initialContent']['description'], '')

    def test_unsafe_seed_and_tampering_are_rejected(self):
        p = package(); p['content'][0]['initialContent']['state'] = 'published'
        with self.assertRaisesRegex(ValueError, 'package_hash'):
            imp.validate(p)
        p['packageId'] = imp.digest({k: v for k, v in p.items() if k != 'packageId'})
        with self.assertRaisesRegex(ValueError, 'unsafe_initial'):
            imp.validate(p)

    def test_unknown_target_fields_cannot_be_smuggled_into_create_proposal(self):
        p = package(); p['content'][0]['initialContent']['id'] = 99
        p['packageId'] = imp.digest({k: v for k, v in p.items() if k != 'packageId'})
        with self.assertRaisesRegex(ValueError, 'unexpected_initial'):
            imp.validate(p)

    def test_unknown_relationship_kinds_and_invalid_statuses_are_rejected(self):
        for kind, status in [('unknown-kind', 'captured'), ('asset', 'public'), ('taxonomy', 'in_package')]:
            p = package()
            edge = {'from': 'wordpress:dbr:post:1', 'to': 'synthetic', 'kind': kind, 'field': 'source', 'status': status}
            edge['id'] = imp.digest(edge)
            p['relationships'].append(edge)
            p['packageId'] = imp.digest({k: v for k, v in p.items() if k != 'packageId'})
            with self.assertRaisesRegex(ValueError, 'unsupported_relationship'):
                imp.validate(p)

    def test_selection_covers_formats_and_excludes_negative_controls(self):
        rows = [record(str(i + 1), [fmt]) for i, fmt in enumerate(imp.FORMATS)]
        denied = record('99', ['pdf']); denied['active_candidate'] = False
        selected = imp.select_records(rows + [denied], 8)
        self.assertEqual({f for r, _ in selected for f in r['formats']}, set(imp.FORMATS))
        self.assertNotIn('99', [r['source_id'] for r, _ in selected])
        with self.assertRaisesRegex(ValueError, 'duplicate_identity'):
            imp.select_records(rows + [rows[0]], 8)

    def test_selection_includes_a_shared_file_pair_when_available(self):
        rows = [record(str(i + 1), [fmt]) for i, fmt in enumerate(imp.FORMATS)]
        shared = {'path': 'wp-content/uploads/shared.pdf', 'status': 'present'}
        rows[0]['assets'] = [shared]
        extra = record('99', ['pdf']); extra['assets'] = [deepcopy(shared)]
        selected = imp.select_records(rows + [extra], 9)
        self.assertTrue({'1', '99'}.issubset({r['source_id'] for r, _ in selected}))


class ReconciliationTests(unittest.TestCase):
    def test_initial_rerun_and_changed_source_preserve_editorial_state(self):
        p = package()
        target = {'schema': 'ae-import-target-state/1', 'records': []}
        self.assertEqual(imp.reconcile(p, target)['counts'], {'create_restricted_intake': 1})
        seed = deepcopy(p['content'][0]['initialContent'])
        seed.update(title='Human title', acceptedTags=['reviewed'], state='draft', accessProfile='human-policy')
        target['records'] = [seed, {'sourceKey': 'wordpress:dbr:post:99', 'sourceHash': 'other'}]
        original = deepcopy(target)
        repeat = imp.reconcile(p, target)
        self.assertEqual(repeat['counts'], {'unchanged': 1})
        self.assertEqual(repeat['existingOutsidePackagePreserved'], 1)
        r = record(); r['title'] = 'Changed source title'; updated = package([r])
        self.assertEqual(imp.reconcile(updated, target)['counts'], {'stage_source_version_for_review': 1})
        self.assertEqual(original, target)
        target['records'][0]['stagedSourceHashes'] = [updated['content'][0]['sourceHash']]
        self.assertEqual(imp.reconcile(updated, target)['counts'], {'unchanged': 1})

    def test_duplicate_target_id_is_not_arbitrarily_overwritten(self):
        row = {'sourceKey': 'wordpress:dbr:post:1'}
        with self.assertRaisesRegex(ValueError, 'duplicate_identity'):
            imp.reconcile(package(), {'schema': 'ae-import-target-state/1', 'records': [row, row]})

    def test_existing_ineligible_source_is_flagged_not_silently_ignored(self):
        p = package()
        p['skipped'] = [{'sourceKey': 'wordpress:dbr:post:99', 'reason': 'source_not_eligible', 'negativeControl': True}]
        p['packageId'] = imp.digest({k: v for k, v in p.items() if k != 'packageId'})
        target = {'schema': 'ae-import-target-state/1', 'records': [{'sourceKey': 'wordpress:dbr:post:99', 'state': 'published', 'title': 'Reviewed'}]}
        before = deepcopy(target)
        result = imp.reconcile(p, target)
        self.assertEqual(result['counts']['review_existing_source_ineligible'], 1)
        self.assertEqual(target, before)


class FileSafetyTests(unittest.TestCase):
    def test_containment_and_file_fingerprints(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); path = root / 'wp-content/uploads/file.pdf'
            path.parent.mkdir(parents=True); path.write_bytes(b'%PDF-synthetic')
            rel = path.relative_to(root).as_posix()
            r = record(); r['assets'] = [{'status': 'present', 'path': rel}]
            hashes = [{'path': rel, 'bytes': path.stat().st_size, 'sha256': imp.file_hash(path), 'stable': True}]
            self.assertEqual(imp.verify_files([r], root, hashes)[rel]['bytes'], path.stat().st_size)
            for unsafe in ['../outside', '/wp-content/x', 'C:/secrets', 'wp-content/x:stream', 'wp-content/../../outside', 'wp-content\\x']:
                with self.assertRaises(ValueError):
                    imp.confined_file(root, unsafe)
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'fingerprint_mismatch'):
                imp.verify_files([r], root, hashes)

    def test_unverified_present_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); path = root / 'wp-content/f.pdf'; path.parent.mkdir(); path.write_bytes(b'x')
            r = record(); r['assets'] = [{'status': 'present', 'path': 'wp-content/f.pdf'}]
            with self.assertRaisesRegex(ValueError, 'missing_or_unstable'):
                imp.verify_files([r], root, [])

    def test_completion_marker_and_output_refusal(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'package'
            p = package()
            files = {'package.json': p, 'summary.json': imp.summarize(p),
                     'dry-run.json': imp.reconcile(p, {'schema': 'ae-import-target-state/1', 'records': []})}
            imp.publish_output(output, files)
            self.assertEqual(imp.load_complete(output), p)
            with self.assertRaises(FileExistsError):
                imp.publish_output(output, files)
            (output / 'package.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'incomplete_or_modified'):
                imp.load_complete(output)
            (output / 'complete.json').unlink()
            with self.assertRaises(FileNotFoundError):
                imp.load_complete(output)

    def test_marker_cannot_omit_promised_reports(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'package'; output.mkdir()
            (output / 'package.json').write_bytes(imp.canonical(package()))
            (output / 'complete.json').write_bytes(imp.canonical({'schema': imp.VERSION,
                'files': {'package.json': imp.file_hash(output / 'package.json')}}))
            with self.assertRaisesRegex(ValueError, 'completion_files_mismatch'):
                imp.load_complete(output)


class EndToEndTests(unittest.TestCase):
    def test_sqlite_capture_excludes_secrets_preserves_repeated_meta_and_rebuilds(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); data = root / 'data'; scan = data / 'scan'; source = data / 'source'
            scan.mkdir(parents=True); source.mkdir()
            r = record(); raw = snapshot(r)
            db = sqlite3.connect(scan / 'inventory.sqlite')
            db.execute('CREATE TABLE wp_posts (' + ','.join(k + ' TEXT' for k in imp.POST_COLUMNS) + ')')
            db.execute('INSERT INTO wp_posts VALUES (' + ','.join('?' for _ in imp.POST_COLUMNS) + ')', [raw['post'][k] for k in imp.POST_COLUMNS])
            db.execute('CREATE TABLE wp_postmeta (meta_id TEXT,post_id TEXT,meta_key TEXT,meta_value TEXT)')
            db.executemany('INSERT INTO wp_postmeta VALUES (?,?,?,?)', [('1', '1', 'notes', 'First'), ('2', '1', 'notes', 'Second'), ('3', '1', '__wpdm_password', 'SYNTHETIC-SECRET')])
            db.commit(); db.close()
            control = record('2'); control['status'] = 'draft'; control['active_candidate'] = False
            files = {'extraction-report.json': {'dump_stable_during_scan': True, 'dump_completion_marker': True, 'sqlite_integrity': 'ok', 'dump_sha256': 'b' * 64},
                     'pilot-file-hashes.json': []}
            for name, value in files.items():
                (scan / name).write_bytes(imp.canonical(value))
            for name, rows in [('pilot-manifest.jsonl', [r]), ('negative-controls.jsonl', [control]), ('attachment-manifest.jsonl', [])]:
                (scan / name).write_bytes(b''.join(imp.canonical(row) + b'\n' for row in rows))
            before = imp.file_hash(scan / 'inventory.sqlite')
            with patch.object(imp, 'ROOT', root):
                first = imp.build(scan, source, data / 'out1', 12)
                second = imp.build(scan, source, data / 'out2', 12)
                self.assertEqual(first, second)
                with self.assertRaisesRegex(ValueError, 'output_already_exists'):
                    imp.build(scan, source, data / 'out1', 12)
                with self.assertRaisesRegex(ValueError, 'separate_ignored'):
                    imp.build(scan, source, source / 'bad', 12)
            p = imp.load_complete(data / 'out1')
            self.assertEqual(len(p['sourceSnapshots'][0]['snapshot']['raw']['metadata']), 2)
            self.assertNotIn('SYNTHETIC-SECRET', json.dumps(p))
            self.assertEqual(first['negativeControlsSkipped'], 1)
            self.assertEqual(before, imp.file_hash(scan / 'inventory.sqlite'))


if __name__ == '__main__':
    unittest.main()
