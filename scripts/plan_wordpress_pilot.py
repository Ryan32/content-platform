"""Build private source manifests and a deterministic pilot from an offline inventory.

No PHP execution, network requests, media downloads, or publication.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import csv
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
# tribe_events excluded: events live in AE Portal and are not migrated (owner decision, 2026-11-18).
MATERIAL_TYPES = {'wpdmpro', 'post', 'page', 'ae_insider_article', 'training_tool', 'wealth_strategy'}
URL = re.compile(r'https?://[^\s<>"\x27\x00]+', re.I)
VIMEO = re.compile(r'(?:player\.)?vimeo\.com/(?:video/|manage/videos/|channels/[^/]+/|groups/[^/]+/videos/)?(\d+)', re.I)
FORMATS = {'.pdf': 'pdf', '.doc': 'word', '.docx': 'word', '.ppt': 'slides', '.pptx': 'slides',
           '.xls': 'spreadsheet', '.xlsx': 'spreadsheet', '.csv': 'spreadsheet',
           '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.mp4': 'video', '.mov': 'video',
           '.zip': 'archive'}
# Featured images become library thumbnails as-is (no generation); only formats the library serves.
FEATURED_TYPES = {'.jpg', '.jpeg', '.png', '.webp'}
FEATURED_MIN_WIDTH = 640


class PHPData:
    """Decode serialization as plain data; never instantiate PHP objects."""
    def __init__(self, text):
        self.data = text.encode('utf-8')
        self.i = 0

    def until(self, delimiter):
        end = self.data.index(delimiter, self.i)
        value = self.data[self.i:end]
        self.i = end + len(delimiter)
        return value

    def take(self, expected):
        if self.data[self.i:self.i + len(expected)] != expected:
            raise ValueError('Invalid serialized delimiter')
        self.i += len(expected)

    def read(self, depth=0):
        if depth > 100:
            raise ValueError('Serialization depth exceeded')
        kind = self.data[self.i:self.i + 1]
        self.i += 1
        if kind == b'N':
            self.take(b';')
            return None
        self.take(b':')
        if kind in (b'i', b'b', b'd'):
            value = self.until(b';')
            return float(value) if kind == b'd' else int(value)
        if kind == b's':
            length = int(self.until(b':'))
            self.take(b'"')
            value = self.data[self.i:self.i + length].decode('utf-8')
            self.i += length
            self.take(b'";')
            return value
        if kind == b'O':
            length = int(self.until(b':'))
            self.take(b'"')
            self.i += length  # Class name discarded; only property data is retained.
            self.take(b'":')
        elif kind != b'a':
            raise ValueError('Unsupported serialization type')
        count = int(self.until(b':'))
        self.take(b'{')
        result = {}
        for _ in range(count):
            key = self.read(depth + 1)
            result[key] = self.read(depth + 1)
        self.take(b'}')
        return result


def decode_php(value):
    if not value or not re.match(r'^(?:[aOsibd]:|N;)', value):
        return value
    parser = PHPData(value)
    result = parser.read()
    if parser.i != len(parser.data):
        raise ValueError('Trailing serialized data')
    return result


def strings(value, prefix=''):
    if isinstance(value, str):
        yield prefix, value
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from strings(child, prefix + '/' + str(key))


def clean_text(value):
    value = re.sub(r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>', ' ', value, flags=re.S | re.I)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', value))).strip()


def date_value(value):
    if not value or value.startswith('0000-'):
        return None
    for pattern in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d', '%m/%d/%Y'):
        try:
            return datetime.strptime(value, pattern)
        except ValueError:
            pass
    return None


def local_reference(value, files, basename_index, source_hosts=None):
    """Never opens outside the backup. Fuzzy basename matches are only suggestions."""
    value = html.unescape(value).replace('\\/', '/').strip()
    if re.match(r'https?://', value, re.I) and source_hosts is not None and urlsplit(value).hostname not in source_hosts:
        return {'status':'external', 'path':None, 'host':urlsplit(value).hostname}
    path = unquote(urlsplit(value).path) if re.match(r'https?://', value, re.I) else unquote(value)
    path = path.replace('\\', '/')
    if '..' in PurePosixPath(path).parts:
        return {'status': 'unsafe_path', 'path': None}
    if '/wp-content/' in path:
        candidate = 'wp-content/' + path.split('/wp-content/', 1)[1]
        candidates = [candidate]
    elif path.startswith('wp-content/'):
        candidates = [path]
    elif re.match(r'https?://', value, re.I):
        return {'status': 'external', 'path': None, 'host': urlsplit(value).hostname}
    else:
        relative = path.lstrip('/')
        candidates = ['wp-content/uploads/' + relative, 'wp-content/uploads/download-manager-files/' + relative,
                      'wp-content/wpdm-assets/' + relative]
    matches = [p for p in candidates if p in files]
    if len(matches) == 1:
        item = files[matches[0]]
        return {'status': 'present' if item['bytes'] else 'zero_bytes', 'path': matches[0], 'bytes': item['bytes']}
    if len(matches) > 1:
        return {'status': 'ambiguous', 'path': None, 'candidates': matches}
    hints = basename_index.get(PurePosixPath(path).name, [])
    return {'status': 'missing', 'path': None, 'basename_candidates': hints}


def featured_image(thumb_id, posts, meta, files, basenames):
    """The post's WordPress featured image (`_thumbnail_id`) as an asset, preferring the smallest generated size
    at least FEATURED_MIN_WIDTH wide so the library thumbnail stays small; falls back to the original upload."""
    thumb_id = str(thumb_id or '').strip()
    if not thumb_id:
        return None
    base = {'field': 'featured_image', 'format': 'other', 'attachment_id': thumb_id}
    post = posts.get(thumb_id)
    values = dict(meta.get(thumb_id, []))
    attached = values.get('_wp_attached_file')
    if not thumb_id.isdigit() or not post or post['post_type'] != 'attachment' or not attached:
        return {**base, 'reference': thumb_id, 'status': 'unresolved', 'path': None}
    try:
        info = decode_php(values.get('_wp_attachment_metadata', ''))
    except (ValueError, IndexError, UnicodeError, TypeError):
        info = None
    sizes = info.get('sizes') if isinstance(info, dict) else None
    folder = PurePosixPath(attached).parent
    variants = []
    for name, size in (sizes.items() if isinstance(sizes, dict) else []):
        width = size.get('width') if isinstance(size, dict) else None
        if isinstance(size.get('file') if isinstance(size, dict) else None, str) and str(width).isdigit() and int(width) >= FEATURED_MIN_WIDTH \
                and '/' not in size['file'] and PurePosixPath(size['file']).suffix.lower() in FEATURED_TYPES:
            variants.append((int(width), str(name), (folder / size['file']).as_posix()))
    choices = [(variant, reference) for _, variant, reference in sorted(variants)] + [('full', attached)]
    for variant, reference in choices:
        found = local_reference(reference, files, basenames)
        if found['status'] == 'present' or variant == 'full':
            break
    status = found['status'] if PurePosixPath(reference).suffix.lower() in FEATURED_TYPES else 'unsupported_image_type'
    return {**base, **found, 'reference': reference, 'variant': variant, 'mime_type': post.get('post_mime_type'), 'status': status}


def inventory_files(source, output):
    files = {}
    for base, dirs, names in os.walk(source, followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(base) / d).is_symlink()]
        for name in names:
            path = Path(base) / name
            if path.is_symlink():
                continue
            stat = path.stat()
            relative = path.relative_to(source).as_posix()
            files[relative] = {'path': relative, 'bytes': stat.st_size, 'mtime_ns': stat.st_mtime_ns}
    with (output / 'files.jsonl').open('w', encoding='utf-8') as stream:
        for item in files.values():
            stream.write(json.dumps(item) + '\n')
    return files


def analyze(scan, source, since, as_of, limit):
    if not scan.resolve().is_relative_to((ROOT / 'data').resolve()):
        raise ValueError('Private output must remain under data/')
    review = scan / 'pilot-review.csv'
    if review.exists():
        with review.open(encoding='utf-8-sig',newline='') as stream:
            if any(row.get('review_disposition') not in ('','pending') for row in csv.DictReader(stream)):
                raise ValueError('Reviewed pilot decisions exist; create a separate scan output instead of overwriting')
    report = json.loads((scan / 'extraction-report.json').read_text(encoding='utf-8'))
    if not report['dump_stable_during_scan'] or report['sqlite_integrity'] != 'ok':
        raise ValueError('Unvalidated extraction')
    source_hosts = {urlsplit(report['options_allowlist'].get(k,'')).hostname for k in ('siteurl','home')}
    conn = sqlite3.connect(f'file:{(scan / "inventory.sqlite").resolve().as_posix()}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    files = inventory_files(source.resolve(), scan)
    basenames = defaultdict(list)
    for path in files:
        basenames[PurePosixPath(path).name].append(path)
    posts = {r['ID']: dict(r) for r in conn.execute('SELECT * FROM wp_posts')}
    children = defaultdict(set)
    for post in posts.values():
        if post['post_type'] == 'attachment' and post['post_parent'] not in ('0', ''):
            children[post['post_parent']].add(post['ID'])
    taxonomy = defaultdict(list)
    for row in conn.execute('SELECT r.object_id,t.term_id,t.name,t.slug,x.taxonomy,x.parent FROM wp_term_relationships r JOIN wp_term_taxonomy x ON r.term_taxonomy_id=x.term_taxonomy_id JOIN wp_terms t ON t.term_id=x.term_id'):
        taxonomy[row['object_id']].append(dict(row))
    term_access = defaultdict(list)
    for row in conn.execute("SELECT term_id,meta_value FROM wp_termmeta WHERE meta_key='__wpdm_access'"):
        try:
            term_access[row['term_id']] = [v for _, v in strings(decode_php(row['meta_value']))]
        except (ValueError, IndexError):
            term_access[row['term_id']] = ['[unparsed]']
    meta = defaultdict(list)
    # Builder history/drafts are preserved in SQLite, but must not contaminate current-content results.
    keys = ['__wpdm_files','__wpdm_access','__wpdm_expire_date','__wpdm_publish_date',
            '__wpdm_individual_file_download','__wpdm_package_dir','__wpdm_fileinfo',
            '__wpdm_password_lock','__wpdm_email_lock','_wp_attached_file','_wp_attachment_metadata','_thumbnail_id',
            'embed_code','video_embed','video_embed_code','__wpdm_video_embed',
            'page_description','notes','ad_review_number','intro','subheadline','kicker',
            '_fl_builder_data','_links_to','_expiration-date','_expiration-date-options',
            '_expiration-date-status','_expiration-date-type','_expiration-date-post-status',
            '_searchwp_excluded','_search_exclude','roles_allowed']
    for row in conn.execute('SELECT post_id,meta_key,meta_value FROM wp_postmeta WHERE meta_key IN (' + ','.join('?' for _ in keys) + ')', keys):
        if row['post_id'] in posts and posts[row['post_id']]['post_type'] != 'revision':
            meta[row['post_id']].append((row['meta_key'], row['meta_value'] or ''))
    start = datetime.fromisoformat(since)
    end = datetime.fromisoformat(as_of + 'T23:59:59')
    cutoff_epoch = end.replace(tzinfo=timezone(timedelta(hours=float(report['options_allowlist'].get('gmt_offset') or 0)))).timestamp()
    records = []
    exceptions = []
    schemas = [dict(r) for r in conn.execute('SELECT meta_key,COUNT(*) AS rows,MAX(LENGTH(meta_value)) AS max_length FROM wp_postmeta GROUP BY meta_key')]
    (scan / 'metadata-key-catalog.json').write_text(json.dumps(schemas, indent=2), encoding='utf-8')
    for pid, post in posts.items():
        if post['post_type'] in {'revision','nav_menu_item','attachment','custom_css','customize_changeset','oembed_cache'} or post['post_type'].startswith('_'):
            continue
        values = dict(meta[pid])
        published = date_value(post['post_date'])
        modified = date_value(post['post_modified'])
        expiry = date_value(values.get('__wpdm_expire_date', ''))
        available = date_value(values.get('__wpdm_publish_date', ''))
        flags = []
        if values.get('__wpdm_expire_date') and expiry is None:
            flags.append('unparsed_expiration')
        if values.get('__wpdm_publish_date') and available is None:
            flags.append('unparsed_availability')
        if expiry and expiry <= end:
            flags.append('expired')
        if (available and available > end) or (published and published > end):
            flags.append('not_yet_available')
        if post['post_password']:
            flags.append('password_protected')
        scheduled = values.get('_expiration-date', '')
        if values.get('_expiration-date-status') == 'saved' and scheduled.isdigit() and int(scheduled) <= cutoff_epoch:
            flags.append('past_due_scheduled_action')
        # Published/private are candidates, not a proof of current access or business validity.
        active = post['post_status'] in {'publish','private'} and not any(f in flags for f in ('expired','not_yet_available','unparsed_expiration','unparsed_availability','past_due_scheduled_action'))
        cohort = 'published_past_year' if published and start <= published <= end else 'older_updated_past_year' if modified and start <= modified <= end else 'outside_window'
        pieces = [('post_content', post['post_content'] or ''), ('post_excerpt', post['post_excerpt'] or '')]
        decoded = {}
        for key, value in meta[pid]:
            try:
                decoded[key] = decode_php(value)
                pieces.extend((key + path, s) for path, s in strings(decoded[key]))
            except (ValueError, IndexError, UnicodeError, TypeError):
                flags.append('unparsed_metadata:' + key)
                pieces.append((key + ':raw', value))
        videos = defaultdict(set)
        assets = []
        attachment_ids = set(children[pid])
        relations = set()
        for field, text in pieces:
            text = html.unescape(text).replace('\\/', '/')
            for vid in VIMEO.findall(text):
                videos[vid].add(field)
            for aid in re.findall(r'(?:wp-image-|attachment[_-])([0-9]+)', text):
                attachment_ids.add(aid)
            for package in re.findall(r'\[wpdm_package\b[^\]]*\bid=[\"\x27]?(\d+)', text, re.I):
                relations.add(package)
            for url in URL.findall(text):
                url = url.rstrip("'.,);]")
                try:
                    ext = PurePosixPath(urlsplit(url).path).suffix.lower()
                except ValueError:
                    flags.append('malformed_url:' + field)
                    continue
                if ext in FORMATS or '/wp-content/uploads/' in url or '.widen.net/' in url:
                    assets.append({'field': field, 'reference': url, 'format': FORMATS.get(ext, 'other'), **local_reference(url, files, basenames, source_hosts)})
        for _, ref in strings(decoded.get('__wpdm_files', {})):
            if ref.isdigit() and ref in posts and posts[ref]['post_type'] == 'attachment':
                attachment_ids.add(ref)
            elif not ref.startswith(('http://', 'https://')):
                assets.append({'field': '__wpdm_files', 'reference': ref, 'format': FORMATS.get(PurePosixPath(ref).suffix.lower(), 'other'), **local_reference(ref, files, basenames, source_hosts)})
        for aid in attachment_ids:
            attached = dict(meta.get(aid, [])).get('_wp_attached_file')
            if attached:
                assets.append({'field': 'attachment:' + aid, 'reference': attached, 'format': FORMATS.get(PurePosixPath(attached).suffix.lower(), 'other'), **local_reference(attached, files, basenames)})
        featured = featured_image(values.get('_thumbnail_id'), posts, meta, files, basenames)
        if featured:
            assets.append(featured)
        unique = {}
        for asset in assets:
            unique[(asset['reference'], asset['field'])] = asset
        assets = list(unique.values())
        for asset in assets:
            if asset['status'] in {'missing','ambiguous','zero_bytes','unsafe_path'}:
                exceptions.append({'post_id': pid, 'cohort': cohort, 'active_candidate': active, **asset})
        roles = set(v for _, v in strings(decoded.get('__wpdm_access', {})))
        for term in taxonomy[pid]:
            if term['taxonomy'] == 'wpdmcategory':
                roles.update(term_access[term['term_id']])
        descriptions = {k: clean_text(v) for k, v in [('post_excerpt', post['post_excerpt'] or ''), ('post_content', post['post_content'] or ''), ('page_description', values.get('page_description','')), ('intro', values.get('intro',''))] if clean_text(v)}
        formats = set(a['format'] for a in assets if a['format'] != 'other')
        if videos:
            formats.add('vimeo')
        if not formats and descriptions:
            formats.add('article')
        if values.get('_fl_builder_data'):
            flags.append('builder_content')
        if values.get('_expiration-date') and values.get('_expiration-date-status') == 'saved':
            flags.append('scheduled_expiration_requires_review')
        records.append({'source_id': pid, 'post_type': post['post_type'], 'status': post['post_status'],
                        'title': post['post_title'], 'slug': post['post_name'], 'source_guid_not_canonical_url': post['guid'],
                        'published_local': post['post_date'], 'modified_local': post['post_modified'],
                        'cohort': cohort, 'active_candidate': active, 'source_expiry': values.get('__wpdm_expire_date'),
                        'source_availability': values.get('__wpdm_publish_date'), 'descriptions': descriptions,
                        'taxonomy': taxonomy[pid], 'package_and_category_roles': sorted(roles),
                        'access_resolution': 'restricted_intake_pending_policy_mapping',
                        'download_rule': values.get('__wpdm_individual_file_download'),
                        'ad_review_number': values.get('ad_review_number'), 'notes': values.get('notes'),
                        'vimeo': [{'id': k, 'fields': sorted(v)} for k,v in videos.items()],
                        'assets': assets, 'linked_package_ids': sorted(relations), 'attachment_ids': sorted(attachment_ids),
                        'formats': sorted(formats), 'flags': sorted(set(flags))})
    eligible = [r for r in records if r['active_candidate'] and r['cohort'] == 'published_past_year' and r['post_type'] in MATERIAL_TYPES]
    # Deterministic diversity sampling: round-robin format, content type, month, and taxonomy.
    groups = defaultdict(list)
    for r in eligible:
        labels = ['type:' + r['post_type'], 'month:' + r['published_local'][:7], 'status:' + r['status']]
        labels += ['format:' + f for f in r['formats']]
        labels += ['taxonomy:' + t['taxonomy'] + ':' + t['term_id'] for t in r['taxonomy']]
        labels += ['edge:' + f for f in r['flags']]
        for label in labels:
            groups[label].append(r)
    for group in groups.values():
        group.sort(key=lambda r: hashlib.sha256(('ae-pilot-v1:' + r['source_id']).encode()).hexdigest())
    selected = {}
    # Ensure small formats are represented before taxonomy-heavy sampling fills the batch.
    quotas = {'slides':10, 'word':10, 'audio':8, 'video':5, 'spreadsheet':5, 'vimeo':30, 'pdf':40, 'article':20}
    for fmt, quota in quotas.items():
        candidates = groups.get('format:' + fmt, [])
        for r in candidates:
            if sum(fmt in x['formats'] for x in selected.values()) >= quota or len(selected) >= limit:
                break
            if r['source_id'] not in selected:
                selected[r['source_id']] = dict(r, selection_reason='format_quota:' + fmt)
    while len(selected) < min(limit, len(eligible)):
        previous = len(selected)
        for label in sorted(groups, key=lambda k: (len(groups[k]), k)):
            candidates = [r for r in groups[label] if r['source_id'] not in selected]
            if candidates:
                r = candidates[0]
                selected[r['source_id']] = dict(r, selection_reason=label)
                if len(selected) == limit:
                    break
        if previous == len(selected):
            break
    controls = [r for r in records if r['cohort'] != 'outside_window' and not r['active_candidate'] and r['post_type'] in MATERIAL_TYPES]
    control_groups = defaultdict(list)
    for r in controls:
        if r['status'] == 'auto-draft':
            continue
        labels = ['status:' + r['status']] + ['flag:' + f for f in r['flags'] if f in {'expired','not_yet_available','past_due_scheduled_action'}]
        for label in labels:
            control_groups[label].append(r)
    picked_controls = {}
    while len(picked_controls) < 20:
        before = len(picked_controls)
        for label in sorted(control_groups):
            remaining = [r for r in control_groups[label] if r['source_id'] not in picked_controls]
            if remaining and len(picked_controls) < 20:
                r = remaining[0]
                picked_controls[r['source_id']] = dict(r, selection_reason='negative:' + label)
        if len(picked_controls) == before:
            break
    controls = list(picked_controls.values())
    for name, items in [('content-manifest.jsonl', records), ('pilot-manifest.jsonl', selected.values()), ('negative-controls.jsonl', controls), ('asset-exceptions.jsonl', exceptions)]:
        with (scan / name).open('w', encoding='utf-8') as stream:
            for r in items:
                stream.write(json.dumps(r, ensure_ascii=False) + '\n')
    with (scan / 'pilot-review.csv').open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.writer(stream)
        writer.writerow(['source_id','title','post_type','status','published_local','formats','vimeo_ids','local_asset_count','external_asset_count','missing_asset_count','description_preview','flags','selection_reason','review_disposition'])
        for r in selected.values():
            row = [r['source_id'],r['title'],r['post_type'],r['status'],r['published_local'], '; '.join(r['formats']), '; '.join(v['id'] for v in r['vimeo']),
                   sum(a['status']=='present' for a in r['assets']),sum(a['status']=='external' for a in r['assets']),sum(a['status']=='missing' for a in r['assets']),
                   next(iter(r['descriptions'].values()),'')[:400],'; '.join(r['flags']),r['selection_reason'],'pending']
            writer.writerow(["'"+x if isinstance(x,str) and x.startswith(('=','+','-','@')) else x for x in row])
    attachment_report = []
    for aid, post in posts.items():
        if post['post_type'] == 'attachment':
            ref = dict(meta.get(aid, [])).get('_wp_attached_file')
            attachment_report.append({'source_id':aid,'parent_id':post['post_parent'],'mime_type':post['post_mime_type'],
                                      'reference':ref,**(local_reference(ref,files,basenames,source_hosts) if ref else {'status':'no_attached_file_metadata','path':None})})
    (scan/'attachment-manifest.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in attachment_report),encoding='utf-8')
    # Hash only referenced pilot files; no expensive full-library content reads.
    fingerprints = []
    for relative in sorted({a['path'] for r in selected.values() for a in r['assets'] if a['status'] == 'present'}):
        path = source / relative
        before = path.stat()
        with path.open('rb') as stream:
            signature = stream.read(16)
            stream.seek(0)
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        after = path.stat()
        fingerprints.append({'path': relative, 'sha256': digest, 'bytes': after.st_size,
                             'stable': (before.st_size,before.st_mtime_ns)==(after.st_size,after.st_mtime_ns),
                             'signature': 'pdf' if signature.startswith(b'%PDF-') else 'zip_or_office' if signature.startswith(b'PK') else 'other'})
    (scan / 'pilot-file-hashes.json').write_text(json.dumps(fingerprints, indent=2), encoding='utf-8')
    summary = {'window': {'since_inclusive': since, 'as_of_inclusive': as_of, 'date_basis': 'WordPress post_date local; modified dates tracked separately'},
               'files': len(files), 'file_bytes': sum(f['bytes'] for f in files.values()),
               'post_type_status': [dict(r) for r in conn.execute('SELECT post_type,post_status,COUNT(*) AS count FROM wp_posts GROUP BY post_type,post_status')],
               'content_records':len(records), 'active_material_candidates': sum(r['active_candidate'] and r['post_type'] in MATERIAL_TYPES for r in records),
               'past_year_active_new': len(eligible), 'past_year_active_updated_older': sum(r['active_candidate'] and r['cohort']=='older_updated_past_year' and r['post_type'] in MATERIAL_TYPES for r in records),
               'past_year_formats': dict(Counter(f for r in eligible for f in r['formats'])),
               'past_year_types': dict(Counter(r['post_type'] for r in eligible)),
               'past_year_no_description': sum(not r['descriptions'] for r in eligible),
               'past_year_unique_vimeo_ids': len({v['id'] for r in eligible for v in r['vimeo']}),
               'past_year_asset_status': dict(Counter(a['status'] for r in eligible for a in r['assets'])),
               'past_year_featured_image_status': dict(Counter(next((a['status'] for a in r['assets'] if a['field'] == 'featured_image'), 'none') for r in eligible)),
               'pilot_records':len(selected), 'pilot_formats':dict(Counter(f for r in selected.values() for f in r['formats'])),
               'pilot_unique_vimeo_ids':len({v['id'] for r in selected.values() for v in r['vimeo']}),
               'pilot_local_files_hashed':len(fingerprints), 'pilot_asset_status':dict(Counter(a['status'] for r in selected.values() for a in r['assets'])),
               'negative_controls':len(controls),
               'attachment_file_status':dict(Counter(r['status'] for r in attachment_report)),
               'past_year_flags':dict(Counter(f for r in eligible for f in r['flags'])),
               'past_year_unique_missing_local_paths':len({a['reference'] for r in eligible for a in r['assets'] if a['status']=='missing'}),
               'limitations':['Not a restored/live-site reconciliation', 'Status/expiry candidates are not confirmed audience authorization',
                              'Current metadata key allowlist; custom schemas, shortcode/Pods relationship resolution need review',
                              'Dates in filenames/titles are not publication evidence', 'External URL presence does not prove retrieval rights',
                              'PDF/Office signatures are not extraction/semantic-quality tests']}
    (scan / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    conn.close()
    print(json.dumps({k:v for k,v in summary.items() if k not in {'post_type_status','limitations'}}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=ROOT / 'data/dbr-backup')
    parser.add_argument('--since', default='2025-11-17')
    parser.add_argument('--as-of', default='2026-11-17')
    parser.add_argument('--limit', type=int, default=200)
    args = parser.parse_args()
    analyze(args.scan, args.source, args.since, args.as_of, args.limit)
