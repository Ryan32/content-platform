"""Read-only Vimeo access test. Never prints credentials or signed file URLs."""
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
config = {}
for line in (ROOT / '.env.local').read_text(encoding='utf-8-sig').splitlines():
    if line.strip() and not line.lstrip().startswith('#') and '=' in line:
        key, value = line.split('=', 1)
        config[key.strip()] = value.strip().strip('\"\'')
token = config.get('VIMEO_ACCESS_TOKEN', '')
video_id = config.get('VIMEO_TEST_VIDEO_ID', '')
if not token or not re.fullmatch(r'\d+', video_id):
    sys.exit('Missing token or invalid numeric video ID in .env.local.')

def api(path):
    request = urllib.request.Request('https://api.vimeo.com' + path, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.vimeo.*+json;version=3.4',
    })
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit('Vimeo API request failed with HTTP ' + str(error.code))

me = api('/me?fields=uri,name')
video = api('/videos/' + video_id)
report = {
    'account_name': me.get('name'),
    'account_uri': me.get('uri'),
    'video_id': video_id,
    'title': video.get('name'),
    'duration_seconds': video.get('duration'),
    'privacy_view': video.get('privacy', {}).get('view'),
    'viewer_download_enabled': video.get('privacy', {}).get('download'),
    'download_entries': len(video.get('download') or []),
    'file_entries': len(video.get('files') or []),
}
print(json.dumps(report, indent=2), flush=True)
candidates = []
for field in ('download', 'files'):
    for item in video.get(field) or []:
        if item.get('link') and item.get('type') == 'video/mp4':
            candidates.append((field, item))
if not candidates:
    sys.exit('No authorized MP4 file link was returned. No download attempted.')
field, selected = min(candidates, key=lambda entry: entry[1].get('size') or float('inf'))
output_dir = ROOT / 'data' / 'vimeo-validation'
output_dir.mkdir(parents=True, exist_ok=True)
target = output_dir / (video_id + '-test.mp4')
if target.exists():
    sys.exit('Test file already exists; refusing to overwrite it.')
temporary = target.with_suffix('.mp4.part')
print(json.dumps({'selected_link_field': field, 'width': selected.get('width'),
                  'height': selected.get('height'), 'expected_bytes': selected.get('size')}), flush=True)
digest = hashlib.sha256()
total = 0
try:
    # CDN links authorize retrieval themselves. Never forward the Vimeo bearer token.
    with urllib.request.urlopen(selected['link'], timeout=120) as response:
        content_type = response.headers.get('Content-Type', '')
        response_length = response.headers.get('Content-Length')
        with temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                total += len(chunk)
    expected = selected.get('size')
    if response_length and total != int(response_length):
        sys.exit('Download does not match HTTP Content-Length; partial file retained.')
    with temporary.open('rb') as source:
        signature = source.read(64)
    if b'ftyp' not in signature:
        sys.exit('Downloaded response lacks an MP4 file signature; retained as .part.')
    temporary.rename(target)
except urllib.error.HTTPError as error:
    sys.exit('Media download failed with HTTP ' + str(error.code))
except Exception as error:
    sys.exit('Media download failed: ' + type(error).__name__)
report.update({'download_success': True, 'selected_link_field': field,
               'http_content_length': response_length, 'api_size_bytes': expected,
               'api_size_matches_download': total == expected,
               'bytes_downloaded': total, 'sha256': digest.hexdigest(),
               'content_type': content_type, 'local_file': str(target)})
(output_dir / (video_id + '-report.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2), flush=True)
