"""Build the AE Library reference seed (carriers and tags) from the WordPress inventory. Read-only; writes into data/.

Run on the laptop that holds the backup scan:
  python scripts/build_reference_seed.py --scan data/wordpress-inventory/scan-2026-11-17-v2

Writes data/reference/:
  wordpress-reference.json  carriers + tags for the Library (schema ae-library-reference/1), applied create-only by the
                            worker once uploaded to s3://<dev bucket>/processing/reference/wordpress-reference.json
  categories-review.csv     every Download Manager category with what happens to it (carrier, tag, or skipped and why)
  roles-report.csv          how many published packages carry each WordPress access-role combination

Decisions (owner, 2026-11-18): carriers from the "Carrier" category; tags from the meaningful category families;
formats, events, and categories that are already structured fields (audience, licensure, business unit) are skipped.
"""
import argparse
from collections import Counter, defaultdict
import csv
import html
import json
from pathlib import Path
import re
import sqlite3

from plan_wordpress_pilot import decode_php, strings

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'ae-library-reference/1'
# Category names (lower case) that are already structured Library fields or formats; never tags.
FIELD_CATEGORIES = {
    'advisor-facing': 'audience field', 'consumer-facing': 'audience field', 'client-facing': 'audience field',
    'iar-ria': 'licensing field', 'ria': 'licensing field', 'insurance only': 'licensing field', 'iar': 'licensing field',
    'annuity': 'product line field', 'annuities': 'product line field', 'life insurance': 'product line field', 'life': 'product line field',
    'medicare': 'product line field', 'ae wealth management': 'product line field', 'aewm': 'product line field', 'wealth management': 'product line field',
    'video': 'format', 'videos': 'format', 'powerpoint': 'format', 'webinar': 'format', 'webinars': 'format', 'brochure': 'format', 'pdf': 'format',
    'excel': 'format', 'word': 'format', 'audio': 'format', 'podcast': 'format', 'flyer': 'format', 'flyers': 'format', 'image': 'format', 'images': 'format',
    'general': 'too generic', 'uncategorized': 'too generic', 'other': 'too generic',
}
EXCLUDED_TREES = {'event': 'events are not migrated', 'events': 'events are not migrated'}
CARRIER_TREES = {'carrier', 'carriers'}
STRATEGY_TREES = {'diversified core', 'risk-efficient income', 'volatility management', 'flex edge model series',
                  'tax-managed & alternative solutions', 'tax-managed and alternative solutions'}
PROGRAM_WORDS = re.compile(r'coaching program|bootcamp|transformation|mastermind|academy|ridgeback|\bg2\b', re.I)
LINE_OF = {'annuity': 'annuity', 'annuities': 'annuity', 'life insurance': 'life', 'life': 'life', 'medicare': 'medicare',
           'ae wealth management': 'wealth', 'aewm': 'wealth'}
# Must match LINES in apps/platform/src/domain/navigation.ts; the worker rejects the whole file otherwise.
APP_LINES = {'annuity', 'life', 'wealth', 'medicare', 'hnw'}
assert set(LINE_OF.values()) <= APP_LINES


def slugify(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower().replace('&', ' ')).strip('-')[:98] or 'item'


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', value or ''))).strip()


def load_categories(conn):
    rows = conn.execute("""SELECT t.term_id, t.name, x.term_taxonomy_id, x.parent, x.count, x.description
                           FROM wp_terms t JOIN wp_term_taxonomy x ON x.term_id = t.term_id WHERE x.taxonomy = 'wpdmcategory'""").fetchall()
    return {str(r[0]): {'id': str(r[0]), 'name': clean(r[1]), 'tt': str(r[2]), 'parent': str(r[3] or '0'), 'count': int(r[4] or 0),
                        'description': clean(r[5])} for r in rows}


def ancestors(cats, cid):
    chain, seen = [], set()
    while cid in cats and cats[cid]['parent'] not in ('0', '') and cid not in seen:
        seen.add(cid)
        cid = cats[cid]['parent']
        if cid in cats:
            chain.append(cats[cid]['name'].lower())
    return chain


def classify(cats, cid):
    """Returns (treatment, detail): ('carrier', ''), ('tag', dimension) or ('skip', reason)."""
    name, chain = cats[cid]['name'].lower(), ancestors(cats, cid)
    for tree, reason in EXCLUDED_TREES.items():
        if name == tree or tree in chain:
            return 'skip', reason
    if name in CARRIER_TREES:
        return 'skip', 'carrier group heading'
    if any(c in CARRIER_TREES for c in chain):
        return 'carrier', ''
    if name in FIELD_CATEGORIES:
        return 'skip', FIELD_CATEGORIES[name]
    if name in STRATEGY_TREES or any(c in STRATEGY_TREES for c in chain):
        return 'tag', 'entity'
    if PROGRAM_WORDS.search(name):
        return 'tag', 'program'
    return 'tag', 'topic'


def carrier_lines(conn, cats, carrier_tt):
    """Product lines for a carrier: business-unit categories on at least 30% of its packages."""
    unit_tt = {c['tt']: LINE_OF[c['name'].lower()] for c in cats.values() if c['name'].lower() in LINE_OF}
    if not unit_tt:
        return []
    objects = [r[0] for r in conn.execute('SELECT object_id FROM wp_term_relationships WHERE term_taxonomy_id = ?', (carrier_tt,))]
    if not objects:
        return []
    counts = Counter()
    for obj in objects:
        lines = {unit_tt[str(r[0])] for r in conn.execute('SELECT term_taxonomy_id FROM wp_term_relationships WHERE object_id = ?', (obj,)) if str(r[0]) in unit_tt}
        counts.update(lines)
    return sorted(line for line, n in counts.items() if n / len(objects) >= 0.3)


def role_report(conn):
    """Access-role combinations on published Download Manager packages (package roles plus category roles)."""
    category_roles = defaultdict(set)
    for term_id, value in conn.execute("SELECT term_id, meta_value FROM wp_termmeta WHERE meta_key = '__wpdm_access'"):
        try:
            category_roles[str(term_id)].update(v for _, v in strings(decode_php(value or '')))
        except (ValueError, IndexError):
            pass
    combos = Counter()
    posts = conn.execute("SELECT ID FROM wp_posts WHERE post_type = 'wpdmpro' AND post_status IN ('publish', 'private')").fetchall()
    for (pid,) in posts:
        roles = set()
        for (value,) in conn.execute("SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '__wpdm_access'", (pid,)):
            try:
                roles.update(v for _, v in strings(decode_php(value or '')))
            except (ValueError, IndexError):
                roles.add('[unparsed]')
        for (term_id,) in conn.execute("""SELECT x.term_id FROM wp_term_relationships r JOIN wp_term_taxonomy x ON x.term_taxonomy_id = r.term_taxonomy_id
                                          WHERE r.object_id = ? AND x.taxonomy = 'wpdmcategory'""", (pid,)):
            roles |= category_roles.get(str(term_id), set())
        combos[' + '.join(sorted(roles - {'__wpdm__'})) or '(none)'] += 1
    return combos


def build(scan, output, min_count):
    if not output.resolve().is_relative_to((ROOT / 'data').resolve()):
        raise ValueError('Private output must stay under data/')
    conn = sqlite3.connect((scan / 'inventory.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        cats = load_categories(conn)
        review, carriers, tags, seen_slugs, seen_keys = [], [], [], set(), set()
        for cid, cat in sorted(cats.items(), key=lambda kv: (-kv[1]['count'], kv[1]['name'].lower())):
            treatment, detail = classify(cats, cid)
            path = ' › '.join(reversed([cat['name']] + [cats[a]['name'] for a in [c for c in [cats[cid]['parent']] if c in cats]]))
            if treatment == 'tag' and cat['count'] < min_count:
                treatment, detail = 'skip', f'fewer than {min_count} packages'
            if treatment == 'carrier':
                slug = slugify(cat['name'])
                if slug in seen_slugs:
                    treatment, detail = 'skip', 'duplicate carrier name'
                else:
                    seen_slugs.add(slug)
                    carriers.append({'name': cat['name'][:120], 'slug': slug, 'lines': carrier_lines(conn, cats, cat['tt'])})
            elif treatment == 'tag':
                key = f'{detail}:{slugify(cat["name"])}'
                if key in seen_keys:
                    treatment, detail = 'skip', 'duplicate tag name'
                else:
                    seen_keys.add(key)
                    parent = cats.get(cat['parent'], {}).get('name')
                    definition = cat['description'] or (f'Content the old site filed under "{parent} › {cat["name"]}".' if parent else f'Content the old site filed under "{cat["name"]}".')
                    tags.append({'key': key, 'label': cat['name'][:80], 'dimension': detail, 'definition': definition[:400]})
            review.append({'category': cat['name'], 'path': path, 'packages': cat['count'], 'treatment': treatment, 'detail': detail})
        combos = role_report(conn)
    finally:
        conn.close()
    output.mkdir(parents=True, exist_ok=True)
    reference = {'schema': SCHEMA, 'carriers': sorted(carriers, key=lambda c: c['name'].lower()), 'tags': sorted(tags, key=lambda t: t['key'])}
    (output / 'wordpress-reference.json').write_text(json.dumps(reference, indent=2, ensure_ascii=False), encoding='utf-8')
    with (output / 'categories-review.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=['category', 'path', 'packages', 'treatment', 'detail'])
        writer.writeheader(); writer.writerows(review)
    with (output / 'roles-report.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream); writer.writerow(['roles', 'published_packages'])
        writer.writerows(combos.most_common())
    return {'carriers': len(carriers), 'tags': len(tags), 'tag_dimensions': dict(Counter(t['dimension'] for t in tags)),
            'skipped': dict(Counter(r['detail'] for r in review if r['treatment'] == 'skip')), 'role_combinations': len(combos)}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--scan', type=Path, required=True, help='Inventory scan folder containing inventory.sqlite')
    parser.add_argument('--output', type=Path, default=ROOT / 'data' / 'reference')
    parser.add_argument('--min-count', type=int, default=3, help='Smallest number of packages for a category to become a tag')
    args = parser.parse_args()
    print(json.dumps(build(args.scan, args.output, args.min_count), indent=2))


if __name__ == '__main__':
    main()
