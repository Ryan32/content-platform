"""Parser tests using synthetic content only."""
import unittest
from inventory_wordpress import parse_values
from plan_wordpress_pilot import decode_php, local_reference, VIMEO


class DumpParserTests(unittest.TestCase):
    def test_mysql_escapes_and_row_boundaries(self):
        rows = list(parse_values(rb"(1,'Title, with (brackets)','it\'s a \\path\nnext',NULL),(2,'Unicode: \"ok\"','',-1);"))
        self.assertEqual(rows, [['1', 'Title, with (brackets)', "it's a \\path\nnext", None], ['2', 'Unicode: "ok"', '', '-1']])

    def test_unicode_and_doubled_quote(self):
        self.assertEqual(list(parse_values("(1,'café','it''s');".encode())), [['1', 'café', "it's"]])

    def test_escaped_pair_preserves_serialized_byte_lengths(self):
        rows = list(parse_values(rb'''(1,'s:2:"\'\'";');'''))
        self.assertEqual(rows[0][1], 's:2:"\'\'";')
        self.assertEqual(decode_php(rows[0][1]), "''")

    def test_refuses_truncated_or_executable_values(self):
        for data in [b"(1,'unfinished", b"(1,LOAD_FILE('secret'));", b"(1,'x'); DROP TABLE t;", b"(1,'x'),;"]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                list(parse_values(data))


class ManifestTests(unittest.TestCase):
    def test_serialized_unicode_object_is_plain_data(self):
        self.assertEqual(decode_php('O:8:"stdClass":1:{s:4:"text";s:5:"café";}'), {'text': 'café'})
        self.assertEqual(decode_php('a:2:{i:0;s:5:"a.pdf";i:1;s:5:"b.pdf";}'), {0:'a.pdf',1:'b.pdf'})

    def test_rejects_invalid_serialization(self):
        with self.assertRaises(ValueError):
            decode_php('s:99:"short";')

    def test_path_traversal_and_ambiguous_matching(self):
        files = {'wp-content/uploads/a.pdf': {'bytes': 100}, 'wp-content/uploads/download-manager-files/a.pdf': {'bytes': 200}}
        self.assertEqual(local_reference('../a.pdf', files, {})['status'], 'unsafe_path')
        self.assertEqual(local_reference('a.pdf', files, {})['status'], 'ambiguous')
        self.assertEqual(local_reference('https://example.test/wp-content/uploads/a.pdf?token=synthetic', files, {})['status'], 'present')
        self.assertEqual(local_reference('x/a.pdf', files, {'a.pdf':list(files)})['status'], 'missing')

    def test_vimeo_embed_and_management_ids(self):
        self.assertEqual(VIMEO.findall('https://player.vimeo.com/video/123456?h=example https://vimeo.com/manage/videos/789012'), ['123456','789012'])


if __name__ == '__main__':
    unittest.main()
