"""Read-only metadata/caption coverage check for a private pilot manifest.

No media downloads. Never writes raw API responses or signed URLs.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(manifest, output, limit):
    if not output.resolve().is_relative_to((ROOT / 'data').resolve()):
        raise ValueError('Report must remain under ignored data/')
    if output.exists():
        raise ValueError('Refusing to overwrite completed validation report')
    config = {}
    for line in (ROOT / '.env.local').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            config[key.strip()] = value.strip().strip('\"\'')
    token = config.get('VIMEO_ACCESS_TOKEN')
    if not token:
        raise ValueError('Vimeo token missing from local configuration')
    opener = urllib.request.build_opener(NoRedirect())

    def api(path):
        request = urllib.request.Request('https://api.vimeo.com' + path, headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.vimeo.*+json;version=3.4'})
        for attempt in range(3):
            try:
                with opener.open(request, timeout=30) as response:
                    return json.load(response), None
            except urllib.error.HTTPError as error:
                if error.code == 429:
                    return None, 'rate_limited_stop'
                if error.code >= 500 and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                return None, 'http_' + str(error.code)
            except (urllib.error.URLError, TimeoutError):
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                return None, 'transport_error'
        return None, 'retry_exhausted'

    references = {}
    for line in manifest.read_text(encoding='utf-8').splitlines():
        item = json.loads(line)
        for video in item['vimeo']:
            if video['id'].isdigit():
                references.setdefault(video['id'], []).append(item['source_id'])
    results = []
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix('.partial.json')
    if partial.exists():
        previous = json.loads(partial.read_text(encoding='utf-8'))
        if previous.get('manifest') != str(manifest):
            raise ValueError('Partial report belongs to a different manifest')
        results = previous['results']
    account, error = api('/me?fields=uri')
    if error:
        raise ValueError('Vimeo authentication check failed: ' + error)
    for vid in sorted(references, key=int)[:limit]:
        if any(x['video_id'] == vid for x in results):
            continue
        data, error = api('/videos/' + vid + '?fields=uri,duration,privacy.view,privacy.download,download,files,modified_time')
        result = {'video_id': vid, 'source_ids': references[vid], 'checked_utc': datetime.now(timezone.utc).isoformat(), 'status': error or 'metadata_accessible'}
        if data:
            result.update(duration_seconds=data.get('duration'), modified_time=data.get('modified_time'),
                          visibility=data.get('privacy', {}).get('view'), viewer_download_enabled=data.get('privacy', {}).get('download'),
                          authorized_download_entries=len(data.get('download') or []), file_entries=len(data.get('files') or []),
                          authorized_mp4_link_present=any(x.get('type') == 'video/mp4' and bool(x.get('link')) for field in ('download','files') for x in data.get(field) or []))
            tracks, track_error = api('/videos/' + vid + '/texttracks?per_page=100')
            result['caption_status'] = track_error or 'metadata_accessible'
            if tracks:
                result['caption_total'] = tracks.get('total')
                entries = tracks.get('data') or []
                result['caption_tracks'] = [{k:x.get(k) for k in ('uri','language','type','active')} for x in entries if isinstance(x,dict)]
                if any(not isinstance(x,dict) for x in entries):
                    result['caption_status'] = 'unexpected_response_shape'
                result['caption_metadata_truncated'] = (tracks.get('total') or 0) > len(result['caption_tracks'])
            if track_error == 'rate_limited_stop':
                error = track_error
        results.append(result)
        report = {'account_uri': account.get('uri'), 'manifest': str(manifest), 'pilot_unique_videos':len(references),
                  'checked':len(results), 'sample_limit':limit, 'results':results,
                  'scope':'Direct ID metadata and texttrack listing only; no media/caption download or quality verification; no mutations.'}
        partial.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'checked':len(results),'status':result['status']}), flush=True)
        if error == 'rate_limited_stop':
            break
        time.sleep(0.2)
    if results:
        partial.replace(output)
    else:
        output.write_text(json.dumps({'checked':0,'pilot_unique_videos':len(references)}), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=20)
    args = parser.parse_args()
    check(args.manifest, args.output, args.limit)
