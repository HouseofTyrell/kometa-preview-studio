#!/usr/bin/env python3
"""
Unit tests for the Plex filtering proxy helper functions.

These tests verify the XML filtering logic and mock library mode
without requiring a real Plex server.

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
    extract_preview_targets,
    # Mock library mode functions
    build_synthetic_library_sections_xml,
    build_synthetic_listing_xml,
    build_synthetic_children_xml,
    is_library_sections_endpoint,
    is_children_endpoint,
    extract_section_id,
    extract_search_query,
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


# ============================================================================
# Mock Library Mode Tests
# ============================================================================

class TestBuildSyntheticLibrarySectionsXml(unittest.TestCase):
    """Tests for build_synthetic_library_sections_xml function"""

    def test_creates_movie_section_for_movies(self):
        """Should create Movies section when targets include movies"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'Matrix'},
        ]
        result = build_synthetic_library_sections_xml(targets)
        root = ET.fromstring(result)

        self.assertEqual(root.tag, 'MediaContainer')
        self.assertEqual(root.get('size'), '1')

        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 1)
        self.assertEqual(dirs[0].get('type'), 'movie')
        self.assertEqual(dirs[0].get('title'), 'Movies')

    def test_creates_show_section_for_shows(self):
        """Should create TV Shows section when targets include shows"""
        targets = [
            {'id': 'bb', 'type': 'show', 'ratingKey': '200', 'title': 'Breaking Bad'},
        ]
        result = build_synthetic_library_sections_xml(targets)
        root = ET.fromstring(result)

        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 1)
        self.assertEqual(dirs[0].get('type'), 'show')
        self.assertEqual(dirs[0].get('title'), 'TV Shows')

    def test_creates_both_sections_for_mixed(self):
        """Should create both sections when targets include movies and shows"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100'},
            {'id': 'bb', 'type': 'show', 'ratingKey': '200'},
        ]
        result = build_synthetic_library_sections_xml(targets)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '2')
        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 2)

        types = {d.get('type') for d in dirs}
        self.assertEqual(types, {'movie', 'show'})

    def test_creates_show_section_for_episodes(self):
        """Should create TV Shows section for episode targets"""
        targets = [
            {'id': 'ep', 'type': 'episode', 'ratingKey': '300'},
        ]
        result = build_synthetic_library_sections_xml(targets)
        root = ET.fromstring(result)

        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 1)
        self.assertEqual(dirs[0].get('type'), 'show')

    def test_fallback_when_no_types(self):
        """Should create both sections when types not specified"""
        targets = [
            {'id': 'item', 'ratingKey': '100'},  # no type
        ]
        result = build_synthetic_library_sections_xml(targets)
        root = ET.fromstring(result)

        # Falls back to both sections
        self.assertEqual(root.get('size'), '2')


class TestBuildSyntheticListingXml(unittest.TestCase):
    """Tests for build_synthetic_listing_xml function"""

    def test_returns_only_allowlist_items(self):
        """Should return only items in targets"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'Matrix'},
            {'id': 'dune', 'type': 'movie', 'ratingKey': '200', 'title': 'Dune'},
        ]
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '2')
        videos = root.findall('Video')
        self.assertEqual(len(videos), 2)

        keys = {v.get('ratingKey') for v in videos}
        self.assertEqual(keys, {'100', '200'})

    def test_creates_video_for_movies(self):
        """Should create Video element for movie targets"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'Matrix', 'year': '1999'},
        ]
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)

        videos = root.findall('Video')
        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].get('type'), 'movie')
        self.assertEqual(videos[0].get('title'), 'Matrix')
        self.assertEqual(videos[0].get('year'), '1999')

    def test_creates_directory_for_shows(self):
        """Should create Directory element for show targets"""
        targets = [
            {'id': 'bb', 'type': 'show', 'ratingKey': '200', 'title': 'Breaking Bad'},
        ]
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)

        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 1)
        self.assertEqual(dirs[0].get('type'), 'show')
        self.assertEqual(dirs[0].get('title'), 'Breaking Bad')

    def test_creates_episode_with_parent_keys(self):
        """Should create Video with parentRatingKey for episodes"""
        targets = [
            {
                'id': 'ep1',
                'type': 'episode',
                'ratingKey': '300',
                'title': 'Pilot',
                'parentRatingKey': '200',
                'grandparentRatingKey': '100',
                'index': 1,
                'parentIndex': 1,
            },
        ]
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)

        videos = root.findall('Video')
        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].get('type'), 'episode')
        self.assertEqual(videos[0].get('parentRatingKey'), '200')
        self.assertEqual(videos[0].get('grandparentRatingKey'), '100')

    def test_creates_season_with_parent_key(self):
        """Should create Directory with parentRatingKey for seasons"""
        targets = [
            {
                'id': 's1',
                'type': 'season',
                'ratingKey': '200',
                'title': 'Season 1',
                'parentRatingKey': '100',
                'index': 1,
            },
        ]
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)

        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 1)
        self.assertEqual(dirs[0].get('type'), 'season')
        self.assertEqual(dirs[0].get('parentRatingKey'), '100')

    def test_search_filter(self):
        """Should filter items by search query"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'The Matrix'},
            {'id': 'dune', 'type': 'movie', 'ratingKey': '200', 'title': 'Dune'},
        ]
        result = build_synthetic_listing_xml(targets, query='Matrix')
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '1')
        videos = root.findall('Video')
        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].get('title'), 'The Matrix')

    def test_case_insensitive_search(self):
        """Search should be case-insensitive"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'The Matrix'},
        ]
        result = build_synthetic_listing_xml(targets, query='matrix')
        root = ET.fromstring(result)
        self.assertEqual(root.get('size'), '1')

    def test_empty_result_when_no_match(self):
        """Should return empty when no items match query"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'Matrix'},
        ]
        result = build_synthetic_listing_xml(targets, query='Inception')
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '0')
        self.assertEqual(len(list(root)), 0)

    def test_skips_targets_without_rating_key(self):
        """Should skip targets without ratingKey"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'Matrix'},
            {'id': 'missing', 'type': 'movie', 'title': 'No Key'},  # no ratingKey
        ]
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '1')

    def test_uses_metadata_cache_for_parent_keys(self):
        """Should use metadata cache for missing parent keys"""
        targets = [
            {'id': 'ep', 'type': 'episode', 'ratingKey': '300', 'title': 'Pilot'},
        ]
        metadata_cache = {
            '300': {
                'ratingKey': '300',
                'parentRatingKey': '200',
                'grandparentRatingKey': '100',
            }
        }
        result = build_synthetic_listing_xml(targets, metadata_cache=metadata_cache)
        root = ET.fromstring(result)

        videos = root.findall('Video')
        self.assertEqual(videos[0].get('parentRatingKey'), '200')
        self.assertEqual(videos[0].get('grandparentRatingKey'), '100')

    def test_correct_size_attribute(self):
        """Size attribute should match actual item count"""
        targets = [
            {'id': 'a', 'type': 'movie', 'ratingKey': '1', 'title': 'A'},
            {'id': 'b', 'type': 'movie', 'ratingKey': '2', 'title': 'B'},
            {'id': 'c', 'type': 'movie', 'ratingKey': '3', 'title': 'C'},
        ]
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '3')
        self.assertEqual(root.get('totalSize'), '3')
        self.assertEqual(root.get('offset'), '0')


class TestBuildSyntheticChildrenXml(unittest.TestCase):
    """Tests for build_synthetic_children_xml function"""

    def test_returns_children_of_parent(self):
        """Should return items with matching parentRatingKey"""
        targets = [
            {'id': 'show', 'type': 'show', 'ratingKey': '100', 'title': 'Breaking Bad'},
            {'id': 's1', 'type': 'season', 'ratingKey': '200', 'title': 'Season 1', 'parentRatingKey': '100'},
            {'id': 's2', 'type': 'season', 'ratingKey': '201', 'title': 'Season 2', 'parentRatingKey': '100'},
            {'id': 'other', 'type': 'season', 'ratingKey': '300', 'title': 'Other Season', 'parentRatingKey': '999'},
        ]
        result = build_synthetic_children_xml('100', targets)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '2')
        dirs = root.findall('Directory')
        self.assertEqual(len(dirs), 2)

        keys = {d.get('ratingKey') for d in dirs}
        self.assertEqual(keys, {'200', '201'})

    def test_returns_grandchildren_of_grandparent(self):
        """Should return items with matching grandparentRatingKey"""
        targets = [
            {'id': 'ep1', 'type': 'episode', 'ratingKey': '300', 'title': 'Ep 1',
             'parentRatingKey': '200', 'grandparentRatingKey': '100'},
        ]
        # Query for show (grandparent)
        result = build_synthetic_children_xml('100', targets)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '1')

    def test_empty_when_no_children(self):
        """Should return empty when parent has no children"""
        targets = [
            {'id': 'movie', 'type': 'movie', 'ratingKey': '100', 'title': 'Matrix'},
        ]
        result = build_synthetic_children_xml('100', targets)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '0')

    def test_uses_metadata_cache_for_parent_keys(self):
        """Should use metadata cache to find children"""
        targets = [
            {'id': 'ep1', 'type': 'episode', 'ratingKey': '300', 'title': 'Episode 1'},
        ]
        metadata_cache = {
            '300': {
                'ratingKey': '300',
                'parentRatingKey': '200',
                'grandparentRatingKey': '100',
            }
        }
        result = build_synthetic_children_xml('200', targets, metadata_cache=metadata_cache)
        root = ET.fromstring(result)

        self.assertEqual(root.get('size'), '1')


class TestIsLibrarySectionsEndpoint(unittest.TestCase):
    """Tests for is_library_sections_endpoint function"""

    def test_matches_library_sections(self):
        """Should match /library/sections"""
        self.assertTrue(is_library_sections_endpoint('/library/sections'))
        self.assertTrue(is_library_sections_endpoint('/library/sections?X-Plex-Token=xxx'))

    def test_not_match_sub_paths(self):
        """Should NOT match sub-paths like /library/sections/1/all"""
        self.assertFalse(is_library_sections_endpoint('/library/sections/1'))
        self.assertFalse(is_library_sections_endpoint('/library/sections/1/all'))
        self.assertFalse(is_library_sections_endpoint('/library/sections/1/search'))


class TestIsChildrenEndpoint(unittest.TestCase):
    """Tests for is_children_endpoint function"""

    def test_matches_children_endpoint(self):
        """Should match /library/metadata/{id}/children and return parent key"""
        self.assertEqual(is_children_endpoint('/library/metadata/12345/children'), '12345')
        self.assertEqual(is_children_endpoint('/library/metadata/999/children?X-Plex-Token=xxx'), '999')

    def test_not_match_other_endpoints(self):
        """Should not match non-children endpoints"""
        self.assertIsNone(is_children_endpoint('/library/metadata/12345'))
        self.assertIsNone(is_children_endpoint('/library/metadata/12345/posters'))
        self.assertIsNone(is_children_endpoint('/library/sections/1/all'))


class TestExtractSectionId(unittest.TestCase):
    """Tests for extract_section_id function"""

    def test_extracts_section_id(self):
        """Should extract section ID from path"""
        self.assertEqual(extract_section_id('/library/sections/1/all'), '1')
        self.assertEqual(extract_section_id('/library/sections/123/search'), '123')
        self.assertEqual(extract_section_id('/library/sections/42/genre'), '42')

    def test_returns_none_when_not_found(self):
        """Should return None for non-section paths"""
        self.assertIsNone(extract_section_id('/library/search'))
        self.assertIsNone(extract_section_id('/library/metadata/12345'))


class TestExtractSearchQuery(unittest.TestCase):
    """Tests for extract_search_query function"""

    def test_extracts_query_parameter(self):
        """Should extract query from query string"""
        self.assertEqual(extract_search_query('/library/search?query=Matrix'), 'Matrix')
        self.assertEqual(extract_search_query('/library/search?query=The%20Matrix'), 'The Matrix')

    def test_extracts_title_parameter(self):
        """Should extract title parameter"""
        self.assertEqual(extract_search_query('/library/sections/1/all?title=Dune'), 'Dune')

    def test_extracts_search_parameter(self):
        """Should extract search parameter"""
        self.assertEqual(extract_search_query('/hubs/search?search=Breaking'), 'Breaking')

    def test_returns_none_when_not_found(self):
        """Should return None when no search query"""
        self.assertIsNone(extract_search_query('/library/sections/1/all'))
        self.assertIsNone(extract_search_query('/library/search'))


class TestExtractPreviewTargets(unittest.TestCase):
    """Tests for extract_preview_targets function"""

    def test_extracts_targets(self):
        """Should extract full target list from config"""
        config = {
            'preview': {
                'targets': [
                    {'id': 'matrix', 'ratingKey': '100', 'title': 'Matrix'},
                    {'id': 'dune', 'ratingKey': '200', 'title': 'Dune'},
                ]
            }
        }
        result = extract_preview_targets(config)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['id'], 'matrix')
        self.assertEqual(result[1]['id'], 'dune')

    def test_returns_empty_for_missing_config(self):
        """Should return empty list for missing preview config"""
        self.assertEqual(extract_preview_targets({}), [])
        self.assertEqual(extract_preview_targets({'preview': {}}), [])


class TestMockModeIntegration(unittest.TestCase):
    """Integration tests for mock library mode"""

    def test_mock_mode_full_flow(self):
        """Test complete mock mode flow: config -> targets -> synthetic XML"""
        config = {
            'preview': {
                'targets': [
                    {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'The Matrix', 'year': '1999'},
                    {'id': 'dune', 'type': 'movie', 'ratingKey': '200', 'title': 'Dune', 'year': '2021'},
                    {'id': 'bb', 'type': 'show', 'ratingKey': '300', 'title': 'Breaking Bad'},
                    {'id': 'bb_s1', 'type': 'season', 'ratingKey': '301', 'title': 'Season 1', 'parentRatingKey': '300'},
                    {'id': 'bb_s1e1', 'type': 'episode', 'ratingKey': '302', 'title': 'Pilot',
                     'parentRatingKey': '301', 'grandparentRatingKey': '300'},
                ]
            }
        }

        # Extract targets and allowed keys
        targets = extract_preview_targets(config)
        allowed_keys = extract_allowed_rating_keys(config)

        self.assertEqual(len(targets), 5)
        self.assertEqual(allowed_keys, {'100', '200', '300', '301', '302'})

        # Build sections XML
        sections_xml = build_synthetic_library_sections_xml(targets)
        sections_root = ET.fromstring(sections_xml)
        self.assertEqual(sections_root.get('size'), '2')  # Movies and TV Shows

        # Build listing XML
        listing_xml = build_synthetic_listing_xml(targets)
        listing_root = ET.fromstring(listing_xml)
        self.assertEqual(listing_root.get('size'), '5')

        # Build children XML for show
        children_xml = build_synthetic_children_xml('300', targets)
        children_root = ET.fromstring(children_xml)
        self.assertEqual(children_root.get('size'), '2')  # season + episode (grandparent match)

    def test_malformed_query_doesnt_break(self):
        """Malformed query strings should not crash"""
        targets = [
            {'id': 'matrix', 'type': 'movie', 'ratingKey': '100', 'title': 'Matrix'},
        ]

        # Test various malformed queries
        result = build_synthetic_listing_xml(targets, query=None)
        root = ET.fromstring(result)
        self.assertEqual(root.get('size'), '1')

        result = build_synthetic_listing_xml(targets, query='')
        root = ET.fromstring(result)
        self.assertEqual(root.get('size'), '1')

    def test_empty_allowlist_fallback(self):
        """Empty allowlist should return empty results"""
        targets = []
        result = build_synthetic_listing_xml(targets)
        root = ET.fromstring(result)
        self.assertEqual(root.get('size'), '0')


if __name__ == '__main__':
    # Run tests with verbose output
    unittest.main(verbosity=2)
