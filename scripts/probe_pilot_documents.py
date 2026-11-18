"""Bounded local text-extraction probes. Private text stays under data/.

Install the pinned optional dependency with:
python -m pip install --target tmp/pilot-python -r scripts/pilot-requirements.txt
"""
from collections import Counter
import argparse
import contextlib
import io
import json
import logging
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tmp/pilot-python'))


def extract(path):
    logging.disable(logging.CRITICAL)
    segments = []
    if path.suffix.lower() == '.pdf':
        from pypdf import PdfReader, __version__
        reader = PdfReader(path)
        if reader.is_encrypted and not reader.decrypt(''):
            return {'status':'encrypted', 'parser_version':__version__}
        total = len(reader.pages)
        for idx in range(min(total, 3)):
            segments.append({'page':idx + 1, 'text':reader.pages[idx].extract_text() or ''})
        result = {'parser':'pypdf', 'parser_version':__version__, 'total_pages':total, 'scope':'first three pages only'}
    else:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if path.suffix.lower() == '.docx':
                selected = [n for n in names if n == 'word/document.xml']
            else:
                selected = [n for n in names if re.fullmatch(r'ppt/(?:slides/slide|notesSlides/notesSlide)\d+\.xml', n)]
            for name in sorted(selected):
                if archive.getinfo(name).file_size > 20 * 1024 * 1024:
                    return {'status':'xml_size_limit'}
                data = archive.read(name)
                if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                    return {'status':'xml_declaration_rejected'}
                tree = ET.fromstring(data)
                text = ' '.join(n.text for n in tree.iter() if n.tag.rsplit('}',1)[-1] == 't' and n.text)
                segments.append({'part':name,'text':text})
            result = {'parser':'stdlib_zip_xml', 'scope':'Word main document text or PowerPoint slides and notes; layout/charts not validated'}
    result.update(status='text_found' if any(s['text'].strip() for s in segments) else 'no_text_needs_review',
                  characters=sum(len(s['text']) for s in segments), segments=segments)
    return result


def run(scan, source):
    if not scan.resolve().is_relative_to((ROOT / 'data').resolve()):
        raise ValueError('Private report must remain under data/')
    destination = scan / 'document-probes'
    destination.mkdir(exist_ok=False)
    hashes = json.loads((scan/'pilot-file-hashes.json').read_text(encoding='utf-8'))
    counts = Counter()
    reports = []
    for item in hashes:
        suffix = Path(item['path']).suffix.lower()
        if suffix not in {'.pdf','.docx','.pptx'} or counts[suffix] >= (20 if suffix == '.pdf' else 10):
            continue
        counts[suffix] += 1
        path = (source / item['path']).resolve()
        if not path.is_relative_to(source.resolve()):
            raise ValueError('Source traversal rejected')
        try:
            completed = subprocess.run([sys.executable, __file__, '--single', str(path)], capture_output=True, timeout=25)
            result = json.loads(completed.stdout) if completed.returncode == 0 else {'status':'parser_failed'}
        except subprocess.TimeoutExpired:
            result = {'status':'timeout'}
        artifact = destination / (item['sha256'] + '.json')
        artifact.write_text(json.dumps({'source_path':item['path'], 'source_sha256':item['sha256'], **result},ensure_ascii=False),encoding='utf-8')
        reports.append({'source_path':item['path'],'format':suffix,'source_sha256':item['sha256'],**{k:v for k,v in result.items() if k!='segments'}})
        print(json.dumps({'checked':len(reports),'status':result['status']}),flush=True)
    (scan/'document-probe-summary.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan', type=Path)
    parser.add_argument('--source',type=Path,default=ROOT/'data/dbr-backup')
    parser.add_argument('--single',type=Path)
    args=parser.parse_args()
    if args.single:
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                result=extract(args.single)
        except Exception as error:
            result={'status':'parser_error','error_type':type(error).__name__}
        print(json.dumps(result))
    else:
        run(args.scan,args.source)
