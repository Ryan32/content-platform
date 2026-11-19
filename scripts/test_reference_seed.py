import csv
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

import build_reference_seed as seed


def make_scan(root: Path):
    db = sqlite3.connect(root / 'inventory.sqlite')
    db.executescript('''
      CREATE TABLE wp_terms (term_id TEXT, name TEXT, slug TEXT);
      CREATE TABLE wp_term_taxonomy (term_taxonomy_id TEXT, term_id TEXT, taxonomy TEXT, description TEXT, parent TEXT, count TEXT);
      CREATE TABLE wp_term_relationships (object_id TEXT, term_taxonomy_id TEXT);
      CREATE TABLE wp_termmeta (meta_id TEXT, term_id TEXT, meta_key TEXT, meta_value TEXT);
      CREATE TABLE wp_posts (ID TEXT, post_type TEXT, post_status TEXT);
      CREATE TABLE wp_postmeta (meta_id TEXT, post_id TEXT, meta_key TEXT, meta_value TEXT);''')
    cats = [  # id, name, parent, count, description
        (1, 'Carrier', 0, 0, ''), (2, 'Athene', 1, 4, ''), (3, 'Pacific Life', 1, 2, ''),
        (4, 'Event', 0, 0, ''), (5, 'The Journey', 4, 9, ''),
        (6, 'Video', 0, 50, ''), (7, 'Annuities', 0, 40, ''), (8, 'Advisor-facing', 0, 90, ''),
        (9, 'Diversified Core', 0, 3, ''), (10, 'Pure Edge Domestic', 9, 3, ''),
        (11, 'Rob Russell Next Generation Coaching Program', 0, 13, ''),
        (12, 'Retirement Planning', 0, 20, 'Income &amp; <b>distribution</b> planning.'), (13, 'Rare Topic', 0, 1, ''),
        (14, 'Life Insurance', 0, 5, ''),
    ]
    for cid, name, parent, count, desc in cats:
        db.execute('INSERT INTO wp_terms VALUES (?,?,?)', (str(cid), name, name.lower()))
        db.execute('INSERT INTO wp_term_taxonomy VALUES (?,?,?,?,?,?)', (f't{cid}', str(cid), 'wpdmcategory', desc, str(parent), str(count)))
    # Athene packages: 3 annuity, 1 life -> annuity only (life is 25%, below 30%).
    for obj, extra in [(100, 't7'), (101, 't7'), (102, 't7'), (103, 't14')]:
        db.execute('INSERT INTO wp_term_relationships VALUES (?,?)', (str(obj), 't2'))
        db.execute('INSERT INTO wp_term_relationships VALUES (?,?)', (str(obj), extra))
    db.execute("INSERT INTO wp_termmeta VALUES ('1','11','__wpdm_access','a:1:{i:0;s:20:\"rob-russell-coaching\";}')")
    for pid, roles in [(100, 'a:2:{i:0;s:9:"full-only";i:1;s:8:"__wpdm__";}'), (101, 'a:1:{i:0;s:9:"full-only";}'), (102, '')]:
        db.execute('INSERT INTO wp_posts VALUES (?,?,?)', (str(pid), 'wpdmpro', 'publish'))
        if roles:
            db.execute('INSERT INTO wp_postmeta VALUES (?,?,?,?)', (str(pid), str(pid), '__wpdm_access', roles))
    db.execute("INSERT INTO wp_term_relationships VALUES ('102','t11')")
    db.execute("INSERT INTO wp_posts VALUES ('104','wpdmpro','draft')")
    db.commit(); db.close()


class ReferenceSeedTest(unittest.TestCase):
    def test_builds_carriers_tags_and_reports_from_the_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            scan = Path(tmp)
            make_scan(scan)
            out = seed.ROOT / 'data' / 'reference-test-tmp'
            try:
                summary = seed.build(scan, out, min_count=3)
                ref = json.loads((out / 'wordpress-reference.json').read_text(encoding='utf-8'))
                self.assertEqual(ref['schema'], 'ae-library-reference/1')
                self.assertEqual(ref['carriers'], [{'name': 'Athene', 'slug': 'athene', 'lines': ['annuity']},
                                                   {'name': 'Pacific Life', 'slug': 'pacific-life', 'lines': []}])
                tags = {t['key']: t for t in ref['tags']}
                self.assertEqual(set(tags), {'entity:diversified-core', 'entity:pure-edge-domestic',
                                             'program:rob-russell-next-generation-coaching-program', 'topic:retirement-planning'})
                self.assertEqual(tags['topic:retirement-planning']['definition'], 'Income & distribution planning.')
                self.assertIn('Diversified Core', tags['entity:pure-edge-domestic']['definition'])
                review = {r['category']: (r['treatment'], r['detail']) for r in csv.DictReader((out / 'categories-review.csv').open(encoding='utf-8'))}
                self.assertEqual(review['The Journey'], ('skip', 'events are not migrated'))
                self.assertEqual(review['Video'], ('skip', 'format'))
                self.assertEqual(review['Advisor-facing'], ('skip', 'audience field'))
                self.assertEqual(review['Rare Topic'], ('skip', 'fewer than 3 packages'))
                roles = dict(csv.reader((out / 'roles-report.csv').open(encoding='utf-8')))
                self.assertEqual(roles['full-only'], '2')
                self.assertEqual(roles['rob-russell-coaching'], '1')
                self.assertNotIn('(none)', roles)
                self.assertEqual(summary['carriers'], 2)
            finally:
                for f in out.glob('*'):
                    f.unlink()
                out.rmdir()

    def test_refuses_output_outside_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            make_scan(Path(tmp))
            with self.assertRaises(ValueError):
                seed.build(Path(tmp), Path(tmp) / 'out', 3)


if __name__ == '__main__':
    unittest.main()
