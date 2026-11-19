"""Fetch WordPress media that lived on AE's Widen library into an import batch folder, so it can be attached to the items.

WordPress pages embedded podcasts, videos and some images from advisorsexcel.widen.net instead of storing them. The
import records those links as external sources and leaves the source snapshot untouched; this script downloads the
files (read-only GETs), verifies them, and writes a sidecar per batch that the import task's attach step uses.

  python scripts/fetch_external_media.py --batch-dir data/wordpress-import/batches/pilot-200-v3 [--only batch-002]

Writes <batch-dir>/files/<sha256>.<ext> (next to the other verified files) and <batch-dir>/<batch>/external-media.json
(schema ae-external-media/1). Rerunnable: files already fetched are reused. Then run infra/aws/library/import-batches.ps1
on the same folder; completed batches are not re-imported, and the attach step adds the new files.

Only https://advisorsexcel.widen.net is fetched; redirects may go to Widen's CDN (*.widencdn.net) and nowhere else.
Share pages (/s/...) are not files and are skipped. Video "view" links are fetched from their /content/ form.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
from urllib.parse import unquote, urlsplit, urlunsplit
import urllib.error
import urllib.request

SCHEMA = 'ae-external-media/1'
HOST = 'advisorsexcel.widen.net'
CDN_SUFFIX = '.widencdn.net'
MAX_BYTES = 2 * 1024 ** 3  # The Library's limit for audio/video (Amazon Transcribe).
CHUNK = 1024 * 1024


def _mp3(head):
    return head[:3] == b'ID3' or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)


SNIFF = {
    'mp3': _mp3,
    'm4a': lambda h: h[4:8] == b'ftyp', 'mp4': lambda h: h[4:8] == b'ftyp',
    'wav': lambda h: h[:4] == b'RIFF' and h[8:12] == b'WAVE',
    'png': lambda h: h[:8] == b'\x89PNG\r\n\x1a\n', 'jpg': lambda h: h[:3] == b'\xff\xd8\xff', 'jpeg': lambda h: h[:3] == b'\xff\xd8\xff',
    'pdf': lambda h: h[:5] == b'%PDF-',
}


def direct_url(reference):
    """The file URL for a Widen reference, or None when it is not a fetchable file (share pages, other hosts)."""
    try:
        url = urlsplit(reference)
    except ValueError:
        return None
    parts = url.path.split('/')
    if url.scheme != 'https' or url.hostname != HOST or url.username or url.port not in (None, 443):
        return None
    if len(parts) == 5 and parts[1] == 'content':
        path = url.path
    elif len(parts) == 5 and parts[1:3] == ['view', 'video']:
        path = '/'.join(['', 'content', parts[3], extension(parts[4]) or 'mp4', parts[4]])
    else:
        return None
    return urlunsplit(('https', HOST, path, url.query, '')) if extension(path) in SNIFF else None


def extension(path):
    name = path.rsplit('/', 1)[-1]
    return name.rsplit('.', 1)[-1].lower() if '.' in name else None


def display_name(reference):
    return unquote(urlsplit(reference).path.rsplit('/', 1)[-1]).replace('\x00', '')[:200] or 'file'


def allowed_redirect(url):
    target = urlsplit(url)
    return target.scheme == 'https' and not target.username and (target.hostname == HOST or (target.hostname or '').endswith(CDN_SUFFIX))


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_redirect(newurl):
            raise ValueError('redirect_to_unapproved_host')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, files_dir, max_bytes=MAX_BYTES, attempts=3):
    """Streams one file into files_dir/<sha256>.<ext>; returns (sha256, bytes). Never keeps a partial or mistyped file."""
    ext = extension(urlsplit(url).path)
    opener = urllib.request.build_opener(_Redirects)
    for attempt in range(1, attempts + 1):
        partial = files_dir / f'.fetch-{os.getpid()}-{attempt}.partial'
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'ae-library-migration/1'})
            with opener.open(request, timeout=60) as response:
                if not allowed_redirect(response.geturl()):
                    raise ValueError('redirect_to_unapproved_host')
                if int(response.headers.get('Content-Length') or 0) > max_bytes:
                    raise ValueError('too_large')
                sha, size, head = hashlib.sha256(), 0, b''
                with open(partial, 'wb') as out:
                    while chunk := response.read(CHUNK):
                        if not head:
                            head = chunk[:16]
                            if not SNIFF[ext](head):
                                raise ValueError('content_is_not_' + ext)
                        size += len(chunk)
                        if size > max_bytes:
                            raise ValueError('too_large')
                        sha.update(chunk)
                        out.write(chunk)
            if not size:
                raise ValueError('empty_file')
            digest = sha.hexdigest()
            final = files_dir / f'{digest}.{ext}'
            if final.exists():
                partial.unlink()
            else:
                partial.replace(final)
            return digest, size
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            partial.unlink(missing_ok=True)
            if attempt == attempts:
                raise ValueError('fetch_failed') from error
            time.sleep(5 * attempt)
        except Exception:
            partial.unlink(missing_ok=True)
            raise


def widen_references(package):
    """(sourceKey, sourceHash, field, reference) for every external Widen asset in the package's source snapshots."""
    hashes = {c['sourceKey']: c['sourceHash'] for c in package['content']}
    for source in package['sourceSnapshots']:
        key = source['sourceKey']
        for asset in source['snapshot']['manifest'].get('assets', []):
            if asset.get('status') == 'external' and asset.get('host') == HOST and asset.get('reference'):
                yield key, hashes[key], asset['field'], asset['reference']


def collect(package, fetch):
    """Builds the sidecar for one package. fetch(url) -> (sha256, bytes); each distinct URL is fetched once."""
    items, skipped, fetched = [], [], {}
    for key, source_hash, field, reference in widen_references(package):
        url = direct_url(reference)
        if not url:
            skipped.append({'sourceKey': key, 'field': field, 'reason': 'not_a_file_link'})
            continue
        try:
            if url not in fetched:
                fetched[url] = fetch(url)
            digest, size = fetched[url]
        except ValueError as error:
            skipped.append({'sourceKey': key, 'field': field, 'reason': str(error)})
            continue
        entry = {'sourceKey': key, 'sourceHash': source_hash, 'field': field,
                 # Host and path only: the share key in the query string stays in the source snapshot.
                 'reference': HOST + urlsplit(reference).path, 'fileName': display_name(reference),
                 'sha256': digest, 'bytes': size, 'ext': extension(urlsplit(url).path)}
        if entry not in items:
            items.append(entry)
    return {'schema': SCHEMA, 'packageId': package['packageId'], 'items': items, 'skipped': skipped}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--batch-dir', type=Path, required=True)
    parser.add_argument('--only', nargs='*', default=None)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    batch_dir = args.batch_dir.resolve()
    if not batch_dir.is_relative_to((root / 'data').resolve()):
        raise SystemExit('batch folder must be under data/')
    manifest = json.loads((batch_dir / 'batches.json').read_text(encoding='utf-8'))
    files_dir = batch_dir / 'files'
    files_dir.mkdir(exist_ok=True)
    for batch in manifest['batches']:
        if args.only and batch['batch'] not in args.only:
            continue
        package = json.loads((batch_dir / batch['batch'] / 'package.json').read_text(encoding='utf-8'))
        sidecar = collect(package, lambda url: download(url, files_dir))
        (batch_dir / batch['batch'] / 'external-media.json').write_text(json.dumps(sidecar, indent=2), encoding='utf-8')
        print(json.dumps({'batch': batch['batch'], 'files': len(sidecar['items']),
                          'bytes': sum(i['bytes'] for i in sidecar['items']), 'skipped': [s['reason'] for s in sidecar['skipped']]}))


if __name__ == '__main__':
    main()
