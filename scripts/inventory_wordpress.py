"""Offline WordPress dump inventory. Never executes SQL/PHP or contacts source services.

Outputs contain private source content and must remain under ignored data/.
The parser deliberately fails on unsupported selected INSERT syntax.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
TABLES = {'wp_posts', 'wp_postmeta', 'wp_terms', 'wp_term_taxonomy',
          'wp_term_relationships', 'wp_termmeta', 'wp_podsrel',
          'wp_ahm_assets', 'wp_ahm_asset_links', 'wp_prli_links'}
OPTIONS = {'siteurl', 'home', 'timezone_string', 'gmt_offset', 'active_plugins',
           'upload_path', 'upload_url_path', '__wpdmcategory', 'wp_user_roles',
           '_wpdm_hide_all', '__wpdm_individual_file_download', '__wpdm_file_browser_root'}
TOKEN = re.compile(rb"'(?:[^'\\]+|\\.|'')*'|NULL|-?\d+(?:\.\d+)?|[(),;]", re.S)
ESCAPES = {b'0': b'\0', b'n': b'\n', b'r': b'\r', b't': b'\t', b'b': b'\b', b'Z': b'\x1a'}


def decode_string(token):
    # Decode doubled SQL quotes and backslash escapes in one pass. Replacing
    # doubled quotes AFTER unescaping corrupts an intentional pair of quotes.
    value = re.sub(rb"\\(.)|''", lambda m: b"'" if m[1] is None else ESCAPES.get(m[1], m[1] if m[1] not in (b'%', b'_') else b'\\' + m[1]), token[1:-1], flags=re.S)
    return value.decode('utf-8', errors='strict')


def parse_values(data):
    """Parse literal-only mysqldump VALUES, including escaped quotes and NULLs."""
    row = None
    expected = 'row'
    end = 0
    for match in TOKEN.finditer(data):
        if data[end:match.start()].strip():
            raise ValueError('Unsupported SQL token (content suppressed)')
        end = match.end()
        token = match[0]
        if expected == 'done':
            raise ValueError('Unexpected trailing SQL')
        if token == b'(' and expected == 'row':
            row, expected = [], 'value'
        elif expected == 'value' and (token.startswith(b"'") or token == b'NULL' or re.fullmatch(rb'-?\d+(?:\.\d+)?', token)):
            row.append(decode_string(token) if token.startswith(b"'") else None if token == b'NULL' else token.decode())
            expected = 'delimiter'
        elif token == b',' and expected == 'delimiter':
            expected = 'value'
        elif token == b')' and expected == 'delimiter':
            yield row
            row, expected = None, 'between'
        elif token == b',' and expected == 'between':
            expected = 'row'
        elif token == b';' and expected == 'between':
            expected = 'done'
        else:
            raise ValueError('Unexpected SQL grammar (content suppressed)')
    if data[end:].strip() or expected != 'done':
        raise ValueError('Incomplete SQL VALUES')


def build_inventory(source, output):
    source = source.resolve()
    output = output.resolve()
    if not output.is_relative_to((ROOT / 'data').resolve()) or output.is_relative_to(source):
        raise ValueError('Output must be under project data/, outside the source backup')
    output.mkdir(parents=True, exist_ok=False)
    dump = source / 'wp-content/mysql.sql'
    before = dump.stat()
    conn = sqlite3.connect(output / 'inventory.sqlite')
    conn.execute('PRAGMA journal_mode=WAL')
    schemas = {}
    counts = Counter()
    statements = Counter()
    all_tables = []
    digest = hashlib.sha256()
    current = None
    completed = False
    options = {}
    try:
        with dump.open('rb') as stream:
            for line in stream:
                digest.update(line)
                completed = completed or line.rstrip().startswith(b'-- Dump completed')
                match = re.match(rb'CREATE TABLE `([^`]+)`', line)
                if match:
                    name = match[1].decode('ascii')
                    all_tables.append(name)
                    current = name if name in TABLES or name == 'wp_options' else None
                    if current:
                        schemas[current] = []
                    continue
                if current:
                    match = re.match(rb'  `([^`]+)` ', line)
                    if match:
                        schemas[current].append(match[1].decode('ascii'))
                    if line.startswith(b')'):
                        columns = ','.join('"' + col + '" TEXT' for col in schemas[current])
                        if current != 'wp_options':
                            conn.execute('CREATE TABLE "' + current + '" (' + columns + ')')
                        current = None
                    continue
                match = re.match(rb'INSERT INTO `([^`]+)` VALUES ', line)
                if not match:
                    if re.match(rb'INSERT INTO `(?:' + b'|'.join(t.encode() for t in TABLES) + rb')`', line):
                        raise ValueError('Unsupported INSERT form')
                    continue
                table = match[1].decode('ascii')
                if table not in schemas:
                    continue
                statements[table] += 1
                batch = []
                for row in parse_values(line[match.end():]):
                    if len(row) != len(schemas[table]):
                        raise ValueError('Column count mismatch in ' + table)
                    counts[table] += 1
                    if table == 'wp_options':
                        option = dict(zip(schemas[table], row))
                        if option['option_name'] in OPTIONS:
                            options[option['option_name']] = option['option_value']
                        continue
                    if table == 'wp_posts':
                        idx = schemas[table].index('post_password')
                        row[idx] = 'present' if row[idx] else ''
                    if table == 'wp_postmeta' and row[2] in {'__wpdm_masterkey', '__wpdm_password'}:
                        row[3] = '[REDACTED: present]' if row[3] else ''
                    batch.append(row)
                    if len(batch) >= 500:
                        conn.executemany('INSERT INTO "' + table + '" VALUES (' + ','.join('?' for _ in row) + ')', batch)
                        batch.clear()
                if batch:
                    conn.executemany('INSERT INTO "' + table + '" VALUES (' + ','.join('?' for _ in batch[0]) + ')', batch)
                if sum(statements.values()) % 100 == 0:
                    conn.commit()
                    print(json.dumps({'parsed_statements': sum(statements.values()), 'table': table}), flush=True)
        for table, column in [('wp_posts', 'ID'), ('wp_postmeta', 'post_id'), ('wp_postmeta', 'meta_key'), ('wp_term_relationships', 'object_id')]:
            conn.execute(f'CREATE INDEX "idx_{table}_{column}" ON "{table}" ("{column}")')
        conn.commit()
        integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
        after = dump.stat()
        stable = (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)
        report = {'created_utc': datetime.now(timezone.utc).isoformat(), 'source_dump': str(dump),
                  'dump_bytes': after.st_size, 'dump_sha256': digest.hexdigest(), 'dump_stable_during_scan': stable,
                  'dump_completion_marker': completed, 'tables_present': all_tables,
                  'selected_rows': dict(counts), 'selected_statements': dict(statements),
                  'sqlite_integrity': integrity, 'options_allowlist': options,
                  'scope': 'Literal SQL extraction only; not a MySQL restore or live-site reconciliation. Users, credentials/options outside allowlist, security logs and form entries excluded.'}
        (output / 'extraction-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        if not stable or not completed or integrity != 'ok':
            raise ValueError('Source stability/completion or output integrity check failed')
        print(json.dumps({'output': str(output), 'rows': dict(counts), 'stable': stable, 'integrity': integrity}), flush=True)
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'data/dbr-backup')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build_inventory(args.source, args.output)
