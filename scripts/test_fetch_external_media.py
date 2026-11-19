import unittest

import fetch_external_media as media

KEY = '?u=abc123'


def package(*assets):
    return {'packageId': 'p1', 'content': [{'sourceKey': 'wordpress:dbr:post:1', 'sourceHash': 'h1'}],
            'sourceSnapshots': [{'sourceKey': 'wordpress:dbr:post:1', 'snapshot': {'manifest': {'assets': list(assets)}}}]}


def widen(field, path, host=media.HOST):
    return {'status': 'external', 'host': host, 'field': field, 'reference': f'https://{host}{path}{KEY}'}


class ExternalMediaTest(unittest.TestCase):
    def test_maps_only_widen_file_links(self):
        self.assertEqual(media.direct_url(f'https://{media.HOST}/content/r0k/mp3/Podcast_12.mp3{KEY}'),
                         f'https://{media.HOST}/content/r0k/mp3/Podcast_12.mp3{KEY}')
        # Video player pages are fetched from their /content/ form.
        self.assertEqual(media.direct_url(f'https://{media.HOST}/view/video/4tr7/Best-Practices.mp4{KEY}'),
                         f'https://{media.HOST}/content/4tr7/mp4/Best-Practices.mp4{KEY}')
        for reference in [f'https://{media.HOST}/s/abc/strategy-guide', f'http://{media.HOST}/content/r0k/mp3/a.mp3',
                          'https://evil.example/content/r0k/mp3/a.mp3', f'https://{media.HOST}/content/r0k/zip/a.zip',
                          f'https://user@{media.HOST}/content/r0k/mp3/a.mp3']:
            self.assertIsNone(media.direct_url(reference), reference)

    def test_follows_redirects_only_to_widen(self):
        self.assertTrue(media.allowed_redirect('https://previews.us-east-1.widencdn.net/x.mp4?sig=1'))
        self.assertTrue(media.allowed_redirect(f'https://{media.HOST}/content/a/mp3/b.mp3'))
        for url in ['https://widencdn.net.evil.example/x', 'http://previews.us-east-1.widencdn.net/x', 'https://cdn.example/x']:
            self.assertFalse(media.allowed_redirect(url), url)

    def test_sniffs_file_types(self):
        self.assertTrue(media.SNIFF['mp3'](b'ID3\x04\x00'))
        self.assertTrue(media.SNIFF['mp4'](b'\x00\x00\x00\x18ftypisom'))
        self.assertFalse(media.SNIFF['mp4'](b'<!doctype html>'))
        self.assertFalse(media.SNIFF['mp3'](b'<!DOCTYPE html>'))

    def test_builds_a_sidecar_fetching_each_file_once_without_the_share_key(self):
        calls = []

        def fetch(url):
            calls.append(url)
            if 'broken' in url:
                raise ValueError('content_is_not_mp3')
            return ('a' * 64, 42)
        sidecar = media.collect(package(widen('embed_code', '/content/r0k/mp3/Lead%20Gen.mp3'), widen('video_embed', '/content/r0k/mp3/Lead%20Gen.mp3'),
                                        widen('notes', '/s/abc/strategy-guide'), widen('embed_code', '/content/zz/mp3/broken.mp3'),
                                        {'status': 'present', 'path': 'wp-content/uploads/a.pdf', 'field': '__wpdm_files'},
                                        widen('embed_code', '/content/r0k/mp3/a.mp3', host='other.example')), fetch)
        self.assertEqual(len(calls), 2)
        self.assertEqual(sidecar['items'], [
            {'sourceKey': 'wordpress:dbr:post:1', 'sourceHash': 'h1', 'field': 'embed_code', 'reference': f'{media.HOST}/content/r0k/mp3/Lead%20Gen.mp3',
             'fileName': 'Lead Gen.mp3', 'sha256': 'a' * 64, 'bytes': 42, 'ext': 'mp3'},
            {'sourceKey': 'wordpress:dbr:post:1', 'sourceHash': 'h1', 'field': 'video_embed', 'reference': f'{media.HOST}/content/r0k/mp3/Lead%20Gen.mp3',
             'fileName': 'Lead Gen.mp3', 'sha256': 'a' * 64, 'bytes': 42, 'ext': 'mp3'}])
        self.assertEqual([s['reason'] for s in sidecar['skipped']], ['not_a_file_link', 'content_is_not_mp3'])
        self.assertNotIn('abc123', str(sidecar))


if __name__ == '__main__':
    unittest.main()
