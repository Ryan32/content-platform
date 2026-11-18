"""Build/validate a private, deterministic WordPress intake package. Never applies it.

Only selected backup files are opened for hashing. No network, PHP execution, media
processing, CMS writes, access grants, or publication. Console output is counts only.
"""
import argparse
from collections import Counter
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'ae-wordpress-intake/1'
NAMESPACE = 'wordpress:dbr'
FORMATS = ['pdf', 'vimeo', 'article', 'slides', 'word', 'audio', 'video', 'spreadsheet']
TARGET_FORMATS = {'pdf': 'pdf', 'vimeo': 'video', 'article': 'article', 'slides': 'slides',
                  'word': 'document', 'audio': 'audio', 'video': 'video', 'spreadsheet': 'document', 'archive': 'document'}
POST_COLUMNS = ('ID', 'post_author', 'post_parent', 'post_type', 'post_status', 'post_title', 'post_name',
                'post_content', 'post_excerpt', 'post_date', 'post_date_gmt', 'post_modified', 'post_modified_gmt', 'guid')
# Preserve rows, not a key->value dict: repeated metadata is meaningful. Passwords,
# tokens, arbitrary plugin settings and users are deliberately excluded.
META_KEYS = ('_fl_builder_data', '_wp_attached_file', '_thumbnail_id', '__wpdm_files', '__wpdm_access',
             '__wpdm_expire_date', '__wpdm_publish_date', '__wpdm_individual_file_download',
             'page_description', 'intro', 'notes', 'ad_review_number', 'subheadline', 'kicker',
             'embed_code', 'video_embed', 'video_embed_code', '__wpdm_video_embed', '_links_to',
             '_expiration-date', '_expiration-date-options', '_expiration-date-status',
             '_expiration-date-type', '_expiration-date-post-status', 'roles_allowed')
BLOCKING_FLAGS = {'expired', 'not_yet_available', 'unparsed_expiration', 'unparsed_availability', 'past_due_scheduled_action'}
MATERIAL_TYPES = {'wpdmpro', 'post', 'page', 'ae_insider_article', 'training_tool', 'wealth_strategy', 'tribe_events'}
PACKAGE_FILES = {'package.json', 'summary.json', 'dry-run.json'}
RELATION_STATUSES = {
    'asset': {'verified_local'},
    'asset-reference': {'captured', 'external', 'missing', 'ambiguous', 'zero_bytes', 'unsafe_path', 'unresolved'},
    'attachment': {'captured', 'unresolved'},
    'vimeo': {'reference_only'},
    'taxonomy': {'captured_not_accepted'},
    'parent': {'in_package', 'outside_package'},
    'linked-package': {'in_package', 'outside_package'},
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def read_lines(path):
    with path.open(encoding='utf-8') as stream:
        return [json.loads(line) for line in stream if line.strip()]


def keyed(rows, key):
    result = {}
    for row in rows:
        identity = str(row[key])
        if identity in result:
            raise ValueError('duplicate_identity')
        result[identity] = row
    return result


def source_key(kind, identity):
    if not re.fullmatch(r'[0-9]+', str(identity)):
        raise ValueError('invalid_source_id')
    return f'{NAMESPACE}:{kind}:{identity}'


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'iframe', 'object'}:
            self.skip += 1
        if not self.skip and tag in {'p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'tr'}:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'iframe', 'object'} and self.skip:
            self.skip -= 1
        elif not self.skip:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def plain(value):
    parser = PlainText()
    parser.feed(value or '')
    return re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()


def eligible(record):
    return (record.get('active_candidate') is True and record.get('cohort') == 'published_past_year'
            and record.get('post_type') in MATERIAL_TYPES
            and record.get('status') in {'publish', 'private'}
            and not BLOCKING_FLAGS.intersection(record.get('flags', [])))


def select_records(rows, limit):
    """One per format, then builder/description/attachment/shared-asset edges."""
    keyed(rows, 'source_id')
    eligible_rows = [r for r in rows if eligible(r)]
    path_counts = Counter(path for r in eligible_rows for path in
                          {a['path'] for a in r.get('assets', []) if a.get('status') == 'present'})
    shared_paths = {path for path, count in path_counts.items() if count > 1}
    candidates = sorted(eligible_rows, key=lambda r: (
        not bool(shared_paths & {a['path'] for a in r.get('assets', []) if a.get('status') == 'present'}), int(r['source_id'])))
    selected = {}
    predicates = [(f'format:{fmt}', lambda r, fmt=fmt: fmt in r.get('formats', [])) for fmt in FORMATS]
    predicates += [('edge:builder', lambda r: 'builder_content' in r.get('flags', [])),
                   ('edge:no-description', lambda r: not r.get('descriptions')),
                   ('edge:attachment', lambda r: bool(r.get('attachment_ids'))),
                   ('edge:shared-asset', lambda r: bool(
                       {a['path'] for a in r.get('assets', []) if a.get('status') == 'present'} &
                       {a['path'] for picked, _ in selected.values() for a in picked.get('assets', []) if a.get('status') == 'present'})),
                   ('edge:package-link', lambda r: bool(r.get('linked_package_ids')))]
    for reason, match in predicates:
        if len(selected) >= limit:
            break
        # Prefer a new record so the subset covers several distinct articles.
        found = next((r for r in candidates if r['source_id'] not in selected and match(r)), None)
        if found:
            selected[found['source_id']] = (found, reason)
    for record in candidates:
        if len(selected) >= limit:
            break
        selected.setdefault(record['source_id'], (record, 'stable-id-fill'))
    return [selected[k] for k in sorted(selected, key=int)]


def confined_file(source, relative):
    """Reject traversal, Windows drives/ADS, and links escaping the untouched backup."""
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('unsafe_asset_path')
    rel = PurePosixPath(relative)
    if rel.is_absolute() or '..' in rel.parts or rel.parts[0] != 'wp-content':
        raise ValueError('unsafe_asset_path')
    resolved = (source / relative).resolve()
    if not resolved.is_relative_to(source.resolve()) or not resolved.is_file():
        raise ValueError('asset_not_present_or_outside_backup')
    return resolved


def verify_files(records, source, fingerprints):
    baseline = keyed(fingerprints, 'path')
    verified = {}
    for relative in sorted({a['path'] for record in records for a in record.get('assets', []) if a.get('status') == 'present'}):
        path = confined_file(source, relative)
        expected = baseline.get(relative)
        if not expected or expected.get('stable') is not True:
            raise ValueError('missing_or_unstable_fingerprint')
        before = path.stat()
        sha = file_hash(path)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('asset_changed_while_hashing')
        if after.st_size <= 0 or sha != expected['sha256'] or after.st_size != expected['bytes']:
            raise ValueError('asset_fingerprint_mismatch')
        verified[relative] = {'sha256': sha, 'bytes': after.st_size}
    return verified


def load_snapshots(scan, ids):
    connection = sqlite3.connect((scan / 'inventory.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        result = {}
        for identity in sorted(ids, key=int):
            rows = connection.execute(f'SELECT {",".join(POST_COLUMNS)} FROM wp_posts WHERE ID=?', (identity,)).fetchall()
            if len(rows) != 1:
                raise ValueError('source_post_missing_or_duplicate')
            metadata = [dict(r) for r in connection.execute(
                'SELECT meta_id,meta_key,meta_value FROM wp_postmeta WHERE post_id=? AND meta_key IN (' +
                ','.join('?' for _ in META_KEYS) + ') ORDER BY CAST(meta_id AS INTEGER)', (identity, *META_KEYS))]
            result[identity] = {'post': dict(rows[0]), 'metadata': metadata}
        return result
    finally:
        connection.close()


def normalized_manifest(record):
    result = {k: v for k, v in record.items() if k != 'selection_reason'}
    # These manifest arrays represent sets; input order is not a content revision.
    for key in ('taxonomy', 'assets', 'vimeo', 'linked_package_ids', 'attachment_ids', 'formats', 'flags', 'package_and_category_roles'):
        values = result.get(key, [])
        if key == 'vimeo':
            values = [dict(v, fields=sorted(v.get('fields', []))) for v in values]
        result[key] = sorted(values, key=lambda v: canonical(v))
    return result


def build_package(selected, snapshots, attachments, verified, provenance, skipped):
    content, blobs, providers, terms, edges, sources = [], {}, {}, {}, {}, []
    selected_keys = {source_key('post', r['source_id']) for r, _ in selected}

    def edge(owner, kind, target, field, status):
        item = {'from': owner, 'kind': kind, 'to': target, 'field': field, 'status': status}
        item['id'] = digest(item)
        edges[item['id']] = item

    for record, reason in selected:
        identity = str(record['source_id'])
        key = source_key('post', identity)
        raw = snapshots[identity]
        post = raw['post']
        if any(str(post[column]) != str(record[field]) for column, field in [
            ('ID', 'source_id'), ('post_title', 'title'), ('post_status', 'status'), ('post_type', 'post_type'),
            ('post_modified', 'modified_local')]):
            raise ValueError('inventory_manifest_disagrees_with_sqlite')
        attachment_rows = []
        issues = set(record.get('flags', [])) | {'source_policy_unresolved', 'canonical_url_unresolved'}
        for aid in sorted(record.get('attachment_ids', []), key=int):
            target = source_key('attachment', aid)
            attached = attachments.get(str(aid))
            if attached:
                attachment_rows.append(attached)
            else:
                issues.add('attachment_metadata_missing')
            edge(key, 'attachment', target, 'attachment_ids', 'captured' if attached else 'unresolved')
        for asset in record.get('assets', []):
            field = asset['field']
            if asset.get('status') == 'present':
                relative = asset['path']
                fingerprint = verified[relative]
                blob = 'sha256:' + fingerprint['sha256']
                if asset.get('bytes') != fingerprint['bytes']:
                    raise ValueError('manifest_asset_size_mismatch')
                entry = blobs.setdefault(blob, {'id': blob, **fingerprint, 'localPaths': [], 'delivery': 'not_uploaded'})
                if relative not in entry['localPaths']:
                    entry['localPaths'].append(relative)
                edge(key, 'asset', blob, field, 'verified_local')
                # Keep a private occurrence with the original reference as well.
                reference_id = 'reference:' + digest(asset)
                edge(key, 'asset-reference', reference_id, field, 'captured')
            else:
                reference_id = 'reference:' + digest(asset)
                edge(key, 'asset-reference', reference_id, field, asset.get('status', 'unresolved'))
                issues.add('asset_reference:' + asset.get('status', 'unresolved'))
        for video in record.get('vimeo', []):
            vid = str(video['id'])
            if not vid.isdigit():
                raise ValueError('invalid_vimeo_id')
            provider_key = 'vimeo:video:' + vid
            providers[provider_key] = {'id': provider_key, 'provider': 'vimeo', 'providerId': vid, 'access': 'not_validated_by_importer'}
            for field in video.get('fields', []) or ['unknown']:
                edge(key, 'vimeo', provider_key, field, 'reference_only')
        for term in record.get('taxonomy', []):
            term_key = f'{NAMESPACE}:term:{term["taxonomy"]}:{term["term_id"]}'
            value = {k: v for k, v in term.items() if k != 'object_id'}
            if term_key in terms and terms[term_key]['source'] != value:
                raise ValueError('conflicting_taxonomy_identity')
            terms[term_key] = {'id': term_key, 'source': value, 'mappingStatus': 'unreviewed'}
            edge(key, 'taxonomy', term_key, 'source_taxonomy', 'captured_not_accepted')
        for related in record.get('linked_package_ids', []):
            target = source_key('post', related)
            edge(key, 'linked-package', target, 'wpdm_package', 'in_package' if target in selected_keys else 'outside_package')
        if post.get('post_parent') not in (None, '', '0', 0):
            target = source_key('post', post['post_parent'])
            edge(key, 'parent', target, 'post_parent', 'in_package' if target in selected_keys else 'outside_package')
        snapshot = {'sourceKey': key, 'raw': raw, 'manifest': normalized_manifest(record),
                    'attachments': attachment_rows,
                    'verifiedFiles': {p: verified[p] for p in sorted({a['path'] for a in record.get('assets', []) if a.get('status') == 'present'})}}
        source_hash = digest(snapshot)
        sources.append({'sourceKey': key, 'sourceHash': source_hash, 'snapshot': snapshot})
        descriptions = record.get('descriptions', {})
        description_field = next((f for f in ('page_description', 'post_excerpt', 'intro', 'post_content') if descriptions.get(f)), None)
        if not description_field:
            issues.add('description_missing')
        if 'builder_content' in issues:
            issues.add('builder_rendering_not_reconstructed')
        title = plain(post.get('post_title'))
        if not title:
            title = f'Untitled source item {identity}'
            issues.add('title_missing')
        formats = record.get('formats', [])
        primary = next((f for f in FORMATS if f in formats), 'document')
        video_ids = sorted({v['id'] for v in record.get('vimeo', [])}, key=int)
        if len(video_ids) > 1:
            issues.add('multiple_vimeo_references')
        # These are INSERT proposals only, never a PATCH for existing content.
        seed = {'sourceKey': key, 'sourceHash': source_hash, 'title': title,
                'description': plain(descriptions.get(description_field, '')),
                'body': plain(post.get('post_content')), 'format': TARGET_FORMATS.get(primary, 'document'),
                'state': 'intake', 'accessProfile': None, 'acceptedTags': [], 'evidenceVersion': 'unprocessed', 'passages': []}
        if len(video_ids) == 1:
            seed['vimeoId'] = video_ids[0]
        content.append({'sourceKey': key, 'sourceHash': source_hash, 'initialContent': seed,
                        'selectionReason': reason, 'descriptionSource': description_field,
                        'formats': sorted(formats), 'issues': sorted(issues),
                        'policy': {'resolution': 'restricted_intake_pending_policy_mapping', 'grants': []}})
    for blob in blobs.values():
        blob['localPaths'].sort()
    package = {'schema': VERSION, 'provenance': provenance,
               'content': content, 'sourceSnapshots': sources,
               'blobs': sorted(blobs.values(), key=lambda b: b['id']),
               'providerAssets': sorted(providers.values(), key=lambda a: a['id']),
               'sourceTaxonomy': sorted(terms.values(), key=lambda t: t['id']),
               'relationships': sorted(edges.values(), key=lambda e: e['id']), 'skipped': skipped}
    package['packageId'] = digest(package)
    validate(package)
    return package


def validate(package):
    if package.get('schema') != VERSION:
        raise ValueError('unsupported_package_schema')
    if package.get('packageId') != digest({k: v for k, v in package.items() if k != 'packageId'}):
        raise ValueError('package_hash_mismatch')
    records = keyed(package['content'], 'sourceKey')
    snapshots = keyed(package['sourceSnapshots'], 'sourceKey')
    if records.keys() != snapshots.keys():
        raise ValueError('snapshot_reconciliation_failed')
    for key, record in records.items():
        snapshot = snapshots[key]
        if key != source_key('post', snapshot['snapshot']['raw']['post']['ID']):
            raise ValueError('source_identity_mismatch')
        if digest(snapshot['snapshot']) != snapshot['sourceHash'] or snapshot['sourceHash'] != record['sourceHash']:
            raise ValueError('snapshot_hash_mismatch')
        seed = record['initialContent']
        allowed_fields = {'sourceKey', 'sourceHash', 'title', 'description', 'body', 'format', 'state',
                          'accessProfile', 'acceptedTags', 'evidenceVersion', 'passages', 'vimeoId'}
        if set(seed) - allowed_fields:
            raise ValueError('unexpected_initial_content_field')
        if (seed.get('sourceKey') != key or seed.get('sourceHash') != record['sourceHash'] or
            seed.get('state') != 'intake' or seed.get('accessProfile') is not None or seed.get('acceptedTags') != [] or
            seed.get('passages') != [] or seed.get('evidenceVersion') != 'unprocessed' or
            record.get('policy') != {'resolution': 'restricted_intake_pending_policy_mapping', 'grants': []}):
            raise ValueError('unsafe_initial_content')
    blobs = keyed(package['blobs'], 'id')
    for blob in blobs.values():
        if (not re.fullmatch(r'[a-f0-9]{64}', blob['sha256']) or blob['id'] != 'sha256:' + blob['sha256']
                or not isinstance(blob['bytes'], int) or blob['bytes'] <= 0 or blob.get('delivery') != 'not_uploaded'):
            raise ValueError('invalid_blob_identity')
    providers = keyed(package['providerAssets'], 'id')
    terms = keyed(package['sourceTaxonomy'], 'id')
    keyed(package['relationships'], 'id')
    for edge in package['relationships']:
        if edge.get('kind') not in RELATION_STATUSES or edge.get('status') not in RELATION_STATUSES[edge['kind']]:
            raise ValueError('unsupported_relationship_kind_or_status')
        if edge['from'] not in records or edge['id'] != digest({k: v for k, v in edge.items() if k != 'id'}):
            raise ValueError('invalid_relationship')
        expected = {'asset': blobs, 'vimeo': providers, 'taxonomy': terms}.get(edge['kind'])
        if expected is not None and edge['to'] not in expected:
            raise ValueError('dangling_relationship')
        if edge['kind'] in {'parent', 'linked-package'} and edge['status'] == 'in_package' and edge['to'] not in records:
            raise ValueError('dangling_content_relationship')
    return package


def reconcile(package, target):
    """Pure dry-run. Existing source versions are staged, never applied to edits."""
    validate(package)
    if target.get('schema') != 'ae-import-target-state/1':
        raise ValueError('unsupported_target_state')
    current = keyed(target.get('records', []), 'sourceKey')
    actions = []
    for record in package['content']:
        existing = current.get(record['sourceKey'])
        if existing is None:
            action = 'create_restricted_intake'
        elif existing.get('sourceHash') == record['sourceHash'] or record['sourceHash'] in existing.get('stagedSourceHashes', []):
            action = 'unchanged'
        else:
            action = 'stage_source_version_for_review'
        actions.append({'sourceKey': record['sourceKey'], 'sourceHash': record['sourceHash'], 'action': action,
                        'existingEditorialFields': 'preserve_all', 'publish': False})
    for skipped in package['skipped']:
        if skipped['reason'] == 'source_not_eligible' and skipped['sourceKey'] in current:
            actions.append({'sourceKey': skipped['sourceKey'], 'action': 'review_existing_source_ineligible',
                            'existingEditorialFields': 'preserve_all', 'publish': False})
    included = {r['sourceKey'] for r in package['content']}
    return {'schema': 'ae-import-dry-run/1', 'packageId': package['packageId'], 'mode': 'dry-run-only',
            'targetStateHash': digest(target), 'actions': actions,
            'counts': dict(sorted(Counter(a['action'] for a in actions).items())),
            'existingOutsidePackagePreserved': len(current.keys() - included), 'deletes': 0, 'grants': 0}


def summarize(package):
    return {'schema': VERSION, 'packageId': package['packageId'], 'records': len(package['content']),
            'sourceSnapshots': len(package['sourceSnapshots']), 'uniqueBlobs': len(package['blobs']),
            'verifiedLocalPaths': sum(len(b['localPaths']) for b in package['blobs']),
            'bytesReferencedUniqueBlobs': sum(b['bytes'] for b in package['blobs']),
            'providerAssets': len(package['providerAssets']), 'sourceTaxonomyTerms': len(package['sourceTaxonomy']),
            'relationshipsByKind': dict(sorted(Counter(e['kind'] for e in package['relationships']).items())),
            'formats': dict(sorted(Counter(f for r in package['content'] for f in r['formats']).items())),
            'issues': dict(sorted(Counter(i for r in package['content'] for i in r['issues']).items())),
            'skipped': len(package['skipped']),
            'skippedByReason': dict(sorted(Counter(s['reason'] for s in package['skipped']).items())),
            'negativeControlsSkipped': sum(s['negativeControl'] for s in package['skipped']),
            'published': 0, 'accessGrants': 0, 'binariesCopied': 0}


def publish_output(output, files):
    """A completion marker is last. An interrupted directory is never reusable."""
    if set(files) != PACKAGE_FILES:
        raise ValueError('completion_files_mismatch')
    output.mkdir(parents=True, exist_ok=False)
    checksums = {}
    for name, value in files.items():
        data = canonical(value) + b'\n'
        with (output / name).open('xb') as stream:
            stream.write(data)
        checksums[name] = hashlib.sha256(data).hexdigest()
    with (output / 'complete.json').open('xb') as stream:
        stream.write(canonical({'schema': VERSION, 'files': checksums}) + b'\n')


def load_complete(output):
    marker = read_json(output / 'complete.json')
    if marker.get('schema') != VERSION:
        raise ValueError('unsupported_completion_marker')
    if not isinstance(marker.get('files'), dict) or set(marker['files']) != PACKAGE_FILES:
        raise ValueError('completion_files_mismatch')
    for name, expected in marker['files'].items():
        if file_hash(output / name) != expected:
            raise ValueError('incomplete_or_modified_package')
    return validate(read_json(output / 'package.json'))


def build(scan, source, output, limit, target=None):
    data = (ROOT / 'data').resolve()
    scan, source, output = scan.resolve(), source.resolve(), output.resolve()
    if not output.is_relative_to(data) or any(output.is_relative_to(p) or p.is_relative_to(output) for p in (scan, source)):
        raise ValueError('output_must_be_separate_ignored_data_directory')
    if output.exists():
        raise ValueError('output_already_exists')
    if not 1 <= limit <= 200:
        raise ValueError('limit_must_be_1_to_200')
    inputs = ['pilot-manifest.jsonl', 'negative-controls.jsonl', 'attachment-manifest.jsonl', 'pilot-file-hashes.json', 'extraction-report.json']
    hashes_before = {name: file_hash(scan / name) for name in inputs}
    report = read_json(scan / 'extraction-report.json')
    if report.get('dump_stable_during_scan') is not True or report.get('dump_completion_marker') is not True or report.get('sqlite_integrity') != 'ok':
        raise ValueError('unvalidated_inventory')
    pilot = read_lines(scan / 'pilot-manifest.jsonl')
    controls = read_lines(scan / 'negative-controls.jsonl')
    all_rows = keyed(pilot + controls, 'source_id')
    selected = select_records(pilot, limit)
    if not selected:
        raise ValueError('no_eligible_pilot_records')
    selected_ids = {r['source_id'] for r, _ in selected}
    skipped = [{'sourceKey': source_key('post', r['source_id']),
                'reason': 'outside_requested_subset' if eligible(r) else 'source_not_eligible',
                'negativeControl': r in controls} for r in sorted(all_rows.values(), key=lambda r: int(r['source_id'])) if r['source_id'] not in selected_ids]
    inventory_before = (scan / 'inventory.sqlite').stat()
    raw = load_snapshots(scan, selected_ids)
    verified = verify_files([r for r, _ in selected], source, read_json(scan / 'pilot-file-hashes.json'))
    attachments = keyed(read_lines(scan / 'attachment-manifest.jsonl'), 'source_id')
    provenance = {'sourceSystem': 'wordpress', 'sourceSite': 'dbr', 'sourceDumpSha256': report['dump_sha256'],
                  'inputHashes': hashes_before, 'selection': {'algorithm': 'format-and-edge-coverage-v3', 'limit': limit},
                  'sourceTimes': 'Preserved verbatim; local/GMT values are not inferred or rewritten.'}
    package = build_package(selected, raw, attachments, verified, provenance, skipped)
    inventory_after = (scan / 'inventory.sqlite').stat()
    if (inventory_before.st_size, inventory_before.st_mtime_ns) != (inventory_after.st_size, inventory_after.st_mtime_ns) or any(
        hashes_before[name] != file_hash(scan / name) for name in inputs):
        raise ValueError('inventory_changed_during_build')
    dry_run = reconcile(package, target or {'schema': 'ae-import-target-state/1', 'records': []})
    summary = summarize(package)
    publish_output(output, {'package.json': package, 'summary.json': summary, 'dry-run.json': dry_run})
    load_complete(output)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('build')
    create.add_argument('--scan', type=Path, default=ROOT / 'data/wordpress-inventory/scan-2026-11-17-v2')
    create.add_argument('--source', type=Path, default=ROOT / 'data/dbr-backup')
    create.add_argument('--output', type=Path, required=True)
    create.add_argument('--limit', type=int, default=12)
    create.add_argument('--target-state', type=Path)
    verify = sub.add_parser('validate')
    verify.add_argument('--package', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'validate':
            result = summarize(load_complete(args.package))
        else:
            result = build(args.scan, args.source, args.output, args.limit,
                           read_json(args.target_state) if args.target_state else None)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        # Do not print exceptions that could embed source content or URLs.
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z][a-z_0-9]+', str(error)) else type(error).__name__
        print(json.dumps({'status': 'failed', 'code': code, 'message': 'Package build/validation failed; source/output was not published to a CMS. Check inputs with synthetic tests; preserve incomplete output.'}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
