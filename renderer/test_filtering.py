#!/usr/bin/env python3
"""
Unit tests for the Plex filtering proxy helper functions.

These tests verify the XML filtering logic without requiring a real Plex server.

Run with:
    python3 -m pytest test_filtering.py -v
    # or simply:
    python3 test_filtering.py
"""

import unittest
import xml.etree.ElementTree as ET

# Import the filtering functions from preview_entrypoint
from preview_entrypoint import (
    filter_media_container_xml,
    create_empty_media_container_xml,
    is_listing_endpoint,
    extract_rating_key_from_path,
    is_metadata_endpoint,
    extract_allowed_rating_keys,
)


class TestFilterMediaContainerXML(unittest.TestCase):
    """Tests for filter_media_container_xml function"""

    def test_filter_videos_by_rating_key(self):
        """Filter Video elements to only include allowed ratingKeys"""
        xml_input = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="5" totalSize="100">
    <Video ratingKey="100" title="Movie A"/>
    <Video ratingKey="200" title="Movie B"/>
    <Video ratingKey="300" title="Movie C"/>
    <Video ratingKey="400" title="Movie D"/>
    <Video ratingKey="500" title="Movie E"/>
</MediaContainer>'''

        allowed = {'100', '300', '500'}
        result = filter_media_container_xml(xml_input, allowed)

        # Parse result
        root = ET.fromstring(result)

        # Should have 3 items
        self.assertEqual(root.get('size'), '3')
        self.assertEqual(root.get('totalSize'), '3')

        # Check that only allowed items remain
        videos = root.findall('Video')
        self.assertEqual(len(videos), 3)

        rating_keys = {v.get('ratingKey') for v in videos}
        self.assertEqual(rating_keys, {'100', '300', '500'})

    def test_filter_directories(self):
        """Filter Directory elements (shows, seasons)"""
        xml_input = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="3">
    <Directory ratingKey="1001" title="Show A"/>
    <Directory ratingKey="1002" title="Show B"/>
    <Directory ratingKey="1003" title="Show C"/>
</MediaContainer>'''

        allowed = {'1002'}
        result = filter_media_container_xml(xml_input, allowed)

        root = ET.fromstring(result)
        self.assertEqual(root.get('size'), '1')

        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 1)
        self.assertEqual(dirs[0].get('ratingKey'), '1002')

    def test_empty_allowlist_removes_all(self):
        """Empty allowlist should remove all items with ratingKey"""
        xml_input = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="3">
    <Video ratingKey="100" title="Movie A"/>
    <Video ratingKey="200" title="Movie B"/>
</MediaContainer>'''

        allowed = set()
        result = filter_media_container_xml(xml_input, allowed)

        root = ET.fromstring(result)
        self.assertEqual(root.get('size'), '0')
        self.assertEqual(len(root.findall('Video')), 0)

    def test_preserves_elements_without_rating_key(self):
        """Elements without ratingKey should not be filtered"""
        xml_input = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="3">
    <Video ratingKey="100" title="Movie A"/>
    <Hub title="Continue Watching"/>
    <Video ratingKey="200" title="Movie B"/>
</MediaContainer>'''

        allowed = {'100'}
        result = filter_media_container_xml(xml_input, allowed)

        root = ET.fromstring(result)
        # Size only counts ratingKey items
        self.assertEqual(root.get('size'), '1')

        # Hub element should still be there
        hubs = root.findall('Hub')
        self.assertEqual(len(hubs), 1)

    def test_handles_no_rating_key_items(self):
        """Container with no ratingKey items should pass through"""
        xml_input = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="2">
    <Hub title="Continue Watching"/>
    <Hub title="Recently Added"/>
</MediaContainer>'''

        allowed = {'100', '200'}
        result = filter_media_container_xml(xml_input, allowed)

        root = ET.fromstring(result)
        # Size remains at 0 (no ratingKey items)
        self.assertEqual(root.get('size'), '0')

        # Hubs still present
        self.assertEqual(len(root.findall('Hub')), 2)

    def test_handles_mixed_elements(self):
        """Handle container with multiple element types"""
        xml_input = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="6">
    <Video ratingKey="100" title="Movie"/>
    <Directory ratingKey="200" title="Show"/>
    <Track ratingKey="300" title="Song"/>
    <Photo ratingKey="400" title="Photo"/>
    <Episode ratingKey="500" title="Episode"/>
    <Season ratingKey="600" title="Season"/>
</MediaContainer>'''

        allowed = {'100', '300', '500'}
        result = filter_media_container_xml(xml_input, allowed)

        root = ET.fromstring(result)
        self.assertEqual(root.get('size'), '3')

        # Check all allowed elements present
        self.assertEqual(len(root.findall('Video')), 1)
        self.assertEqual(len(root.findall('Track')), 1)
        self.assertEqual(len(root.findall('Episode')), 1)

        # Check filtered out
        self.assertEqual(len(root.findall('Directory')), 0)
        self.assertEqual(len(root.findall('Photo')), 0)
        self.assertEqual(len(root.findall('Season')), 0)

    def test_invalid_xml_returns_unchanged(self):
        """Invalid XML should return unchanged"""
        invalid_xml = b'this is not xml'
        result = filter_media_container_xml(invalid_xml, {'100'})
        self.assertEqual(result, invalid_xml)

    def test_resets_offset(self):
        """Should reset offset to 0 for filtered results"""
        xml_input = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="10" totalSize="100" offset="50">
    <Video ratingKey="100" title="Movie"/>
</MediaContainer>'''

        allowed = {'100'}
        result = filter_media_container_xml(xml_input, allowed)

        root = ET.fromstring(result)
        self.assertEqual(root.get('offset'), '0')
        self.assertEqual(root.get('size'), '1')
        self.assertEqual(root.get('totalSize'), '1')


class TestCreateEmptyMediaContainer(unittest.TestCase):
    """Tests for create_empty_media_container_xml"""

    def test_creates_valid_empty_container(self):
        """Should create a valid empty MediaContainer"""
        result = create_empty_media_container_xml()

        # Should be valid XML
        root = ET.fromstring(result)
        self.assertEqual(root.tag, 'MediaContainer')
        self.assertEqual(root.get('size'), '0')
        self.assertEqual(len(list(root)), 0)


class TestIsListingEndpoint(unittest.TestCase):
    """Tests for is_listing_endpoint function"""

    def test_section_all_endpoint(self):
        """Detect /library/sections/X/all"""
        self.assertTrue(is_listing_endpoint('/library/sections/1/all'))
        self.assertTrue(is_listing_endpoint('/library/sections/123/all'))
        self.assertTrue(is_listing_endpoint('/library/sections/1/all?type=1'))

    def test_section_search_endpoint(self):
        """Detect /library/sections/X/search"""
        self.assertTrue(is_listing_endpoint('/library/sections/1/search'))
        self.assertTrue(is_listing_endpoint('/library/sections/1/search?title=test'))

    def test_library_search_endpoint(self):
        """Detect /library/search"""
        self.assertTrue(is_listing_endpoint('/library/search'))
        self.assertTrue(is_listing_endpoint('/library/search?query=test'))

    def test_hub_search_endpoint(self):
        """Detect /hubs/search"""
        self.assertTrue(is_listing_endpoint('/hubs/search'))
        self.assertTrue(is_listing_endpoint('/hubs/search?query=test'))

    def test_browse_endpoints(self):
        """Detect browse endpoints"""
        self.assertTrue(is_listing_endpoint('/library/sections/1/genre'))
        self.assertTrue(is_listing_endpoint('/library/sections/1/year'))
        self.assertTrue(is_listing_endpoint('/library/sections/1/decade'))
        self.assertTrue(is_listing_endpoint('/library/sections/1/recentlyAdded'))

    def test_non_listing_endpoints(self):
        """Should not match non-listing endpoints"""
        self.assertFalse(is_listing_endpoint('/library/metadata/12345'))
        self.assertFalse(is_listing_endpoint('/library/sections'))
        self.assertFalse(is_listing_endpoint('/'))
        self.assertFalse(is_listing_endpoint('/photo/:/transcode'))


class TestExtractRatingKeyFromPath(unittest.TestCase):
    """Tests for extract_rating_key_from_path function"""

    def test_metadata_endpoint(self):
        """Extract from /library/metadata/X"""
        self.assertEqual(extract_rating_key_from_path('/library/metadata/12345'), '12345')
        self.assertEqual(extract_rating_key_from_path('/library/metadata/12345/children'), '12345')
        self.assertEqual(extract_rating_key_from_path('/library/metadata/12345?X-Plex-Token=xxx'), '12345')

    def test_thumb_endpoint(self):
        """Extract from artwork endpoints"""
        self.assertEqual(extract_rating_key_from_path('/library/metadata/12345/thumb'), '12345')
        self.assertEqual(extract_rating_key_from_path('/library/metadata/12345/art'), '12345')
        self.assertEqual(extract_rating_key_from_path('/library/metadata/12345/poster'), '12345')

    def test_no_rating_key(self):
        """Return None for paths without ratingKey"""
        self.assertIsNone(extract_rating_key_from_path('/library/sections/1/all'))
        self.assertIsNone(extract_rating_key_from_path('/'))
        self.assertIsNone(extract_rating_key_from_path('/library/search'))


class TestIsMetadataEndpoint(unittest.TestCase):
    """Tests for is_metadata_endpoint function"""

    def test_metadata_endpoints(self):
        """Detect metadata endpoints"""
        self.assertTrue(is_metadata_endpoint('/library/metadata/12345'))
        self.assertTrue(is_metadata_endpoint('/library/metadata/12345/children'))
        self.assertTrue(is_metadata_endpoint('/library/metadata/12345?X-Plex-Token=xxx'))

    def test_upload_endpoints_not_metadata(self):
        """Upload endpoints should NOT be detected as metadata"""
        self.assertFalse(is_metadata_endpoint('/library/metadata/12345/posters'))
        self.assertFalse(is_metadata_endpoint('/library/metadata/12345/poster'))
        self.assertFalse(is_metadata_endpoint('/library/metadata/12345/arts'))

    def test_non_metadata_endpoints(self):
        """Non-metadata endpoints"""
        self.assertFalse(is_metadata_endpoint('/library/sections/1/all'))
        self.assertFalse(is_metadata_endpoint('/hubs/search'))


class TestExtractAllowedRatingKeys(unittest.TestCase):
    """Tests for extract_allowed_rating_keys function"""

    def test_extracts_from_targets(self):
        """Extract ratingKeys from preview targets"""
        config = {
            'preview': {
                'targets': [
                    {'id': 'matrix', 'ratingKey': '12345'},
                    {'id': 'dune', 'ratingKey': '12346'},
                    {'id': 'show', 'rating_key': '12347'},  # alternate key name
                    {'id': 'item', 'plex_id': '12348'},     # another alternate
                ]
            }
        }
        result = extract_allowed_rating_keys(config)
        self.assertEqual(result, {'12345', '12346', '12347', '12348'})

    def test_empty_config(self):
        """Empty config returns empty set"""
        self.assertEqual(extract_allowed_rating_keys({}), set())
        self.assertEqual(extract_allowed_rating_keys({'preview': {}}), set())
        self.assertEqual(extract_allowed_rating_keys({'preview': {'targets': []}}), set())

    def test_skips_missing_rating_keys(self):
        """Targets without ratingKey are skipped"""
        config = {
            'preview': {
                'targets': [
                    {'id': 'matrix', 'ratingKey': '12345'},
                    {'id': 'missing', 'title': 'No ratingKey'},
                ]
            }
        }
        result = extract_allowed_rating_keys(config)
        self.assertEqual(result, {'12345'})

    def test_converts_to_string(self):
        """Integer ratingKeys are converted to strings"""
        config = {
            'preview': {
                'targets': [
                    {'id': 'matrix', 'ratingKey': 12345},  # int not string
                ]
            }
        }
        result = extract_allowed_rating_keys(config)
        self.assertEqual(result, {'12345'})


class TestIntegration(unittest.TestCase):
    """Integration tests combining multiple functions"""

    def test_full_filtering_flow(self):
        """Test complete flow: config -> allowlist -> filter"""
        # Sample config like what would be in preview.yml
        config = {
            'preview': {
                'targets': [
                    {'id': 'matrix', 'ratingKey': '100', 'title': 'The Matrix'},
                    {'id': 'dune', 'ratingKey': '200', 'title': 'Dune'},
                ]
            }
        }

        # Sample Plex library response
        plex_response = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="5" totalSize="1000">
    <Video ratingKey="100" title="The Matrix"/>
    <Video ratingKey="200" title="Dune"/>
    <Video ratingKey="300" title="Inception"/>
    <Video ratingKey="400" title="Interstellar"/>
    <Video ratingKey="500" title="Avatar"/>
</MediaContainer>'''

        # Extract allowlist from config
        allowed = extract_allowed_rating_keys(config)
        self.assertEqual(allowed, {'100', '200'})

        # Filter the response
        filtered = filter_media_container_xml(plex_response, allowed)
        root = ET.fromstring(filtered)

        # Verify only 2 items remain
        self.assertEqual(root.get('size'), '2')
        self.assertEqual(root.get('totalSize'), '2')

        videos = root.findall('Video')
        self.assertEqual(len(videos), 2)

        titles = {v.get('title') for v in videos}
        self.assertEqual(titles, {'The Matrix', 'Dune'})


if __name__ == '__main__':
    # Run tests with verbose output
    unittest.main(verbosity=2)
