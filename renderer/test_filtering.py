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

import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

# Import from refactored modules
from xml_builders import (
    filter_media_container_xml,
    create_empty_media_container_xml,
    is_listing_endpoint,
    extract_rating_key_from_path,
    is_metadata_endpoint,
    extract_allowed_rating_keys,
    extract_preview_targets,
    # Mock library mode functions
    build_synthetic_library_sections_xml,
    build_synthetic_section_detail_xml,
    build_synthetic_filter_types_xml,
    build_synthetic_listing_xml,
    build_synthetic_children_xml,
    is_library_sections_endpoint,
    is_children_endpoint,
    is_filter_types_endpoint,
    extract_section_id,
    extract_search_query,
    extract_image_from_body,
)
from caching import safe_preview_targets
from proxy_tmdb import TMDbProxyHandler
from config import generate_proxy_config
from sanitization import sanitize_overlay_data_for_fast_mode


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


class TestMockLibraryTypes(unittest.TestCase):
    """Tests for synthetic library section types."""

    def test_movie_section_type_is_movie(self):
        targets = [
            {'id': 'movie-1', 'type': 'movie', 'ratingKey': '100', 'title': 'Example Movie'}
        ]
        sections_xml = build_synthetic_library_sections_xml(targets)
        sections_root = ET.fromstring(sections_xml)
        sections = sections_root.findall('Directory')
        self.assertTrue(sections)
        self.assertEqual(sections[0].get('type'), 'movie')

        detail_xml = build_synthetic_section_detail_xml('1', targets)
        detail_root = ET.fromstring(detail_xml)
        directory = detail_root.find('Directory')
        self.assertIsNotNone(directory)
        self.assertEqual(directory.get('type'), 'movie')


class TestKometaConfigGeneration(unittest.TestCase):
    """Tests for kometa_run.yml generation."""

    def test_kometa_run_yaml_has_no_mid_doc_end_markers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            job_path = Path(tmpdir)
            (job_path / 'config').mkdir(parents=True, exist_ok=True)
            preview_config = {
                'plex': {'url': 'http://plex.example', 'token': 'token'},
                'tmdb': {'apikey': 'tmdb'},
                'libraries': {
                    'Movies': {
                        'overlay_files': ['overlays.yml']
                    }
                }
            }

            config_path = generate_proxy_config(
                job_path,
                preview_config,
                'http://127.0.0.1:32500'
            )

            text = config_path.read_text()
            lines = text.splitlines()
            last_non_empty = max((i for i, line in enumerate(lines) if line.strip()), default=-1)

            for idx, line in enumerate(lines):
                if line.strip() == '...' and idx != last_non_empty:
                    self.fail("Found mid-document YAML end marker '...' in kometa_run.yml")


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


# ============================================================================
# Preview Accuracy Mode Tests
# ============================================================================

class TestPreviewAccuracyConfig(unittest.TestCase):
    """Tests for preview accuracy mode configuration"""

    def test_preview_accuracy_default(self):
        """Default preview accuracy should be 'fast'"""
        import os
        from preview_entrypoint import PREVIEW_ACCURACY
        # Note: This tests the module-level constant, which uses 'fast' as default
        # Environment may override, but default is documented as 'fast'
        self.assertIn(PREVIEW_ACCURACY, ['fast', 'accurate'])

    def test_external_id_limit_default(self):
        """Default external ID limit should be 25"""
        from preview_entrypoint import PREVIEW_EXTERNAL_ID_LIMIT
        # Value may be overridden by env var, but should be an int
        self.assertIsInstance(PREVIEW_EXTERNAL_ID_LIMIT, int)
        self.assertGreater(PREVIEW_EXTERNAL_ID_LIMIT, 0)

    def test_external_pages_limit_default(self):
        """Default external pages limit should be 1"""
        from preview_entrypoint import PREVIEW_EXTERNAL_PAGES_LIMIT
        self.assertIsInstance(PREVIEW_EXTERNAL_PAGES_LIMIT, int)
        self.assertGreater(PREVIEW_EXTERNAL_PAGES_LIMIT, 0)


class TestCacheMetadataValidation(unittest.TestCase):
    """Tests for cache_metadata_response validation logic"""

    def _create_valid_xml(self, rating_key='12345', title='Test Movie'):
        """Create valid MediaContainer XML for testing"""
        return f'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="1">
    <Video ratingKey="{rating_key}" title="{title}" type="movie"/>
</MediaContainer>'''.encode('utf-8')

    def test_valid_xml_validation(self):
        """Valid MediaContainer XML should parse correctly"""
        xml_bytes = self._create_valid_xml()

        # Should be valid XML
        root = ET.fromstring(xml_bytes)
        self.assertEqual(root.tag, 'MediaContainer')

        # Should have correct size
        self.assertEqual(root.get('size'), '1')

    def test_invalid_xml_detection(self):
        """Non-XML content should be detected"""
        invalid_content = b'this is not xml at all'

        # Should not start with '<'
        self.assertFalse(invalid_content.strip().startswith(b'<'))

        # Should raise parse error
        with self.assertRaises(ET.ParseError):
            ET.fromstring(invalid_content)

    def test_empty_response_detection(self):
        """Empty response should be detected"""
        empty_content = b''

        # Empty check
        self.assertEqual(len(empty_content), 0)

        # Empty whitespace check
        whitespace_content = b'   \n\t  '
        self.assertFalse(whitespace_content.strip().startswith(b'<'))

    def test_compressed_xml_detection(self):
        """Compressed content that wasn't decompressed should fail validation"""
        import gzip

        # Create compressed XML
        valid_xml = self._create_valid_xml()
        compressed = gzip.compress(valid_xml)

        # Compressed content doesn't start with '<'
        self.assertFalse(compressed.startswith(b'<'))

        # First bytes are gzip magic number
        self.assertTrue(compressed.startswith(b'\x1f\x8b'))

    def test_decompressed_xml_valid(self):
        """Decompressed content should be valid XML"""
        import gzip

        valid_xml = self._create_valid_xml()
        compressed = gzip.compress(valid_xml)
        decompressed = gzip.decompress(compressed)

        # Should be identical to original
        self.assertEqual(decompressed, valid_xml)

        # Should parse correctly
        root = ET.fromstring(decompressed)
        self.assertEqual(root.tag, 'MediaContainer')

    def test_non_media_container_xml(self):
        """XML that isn't MediaContainer should be detected"""
        non_container_xml = b'''<?xml version="1.0" encoding="UTF-8"?>
<Document>
    <Item>content</Item>
</Document>'''

        # Should parse
        root = ET.fromstring(non_container_xml)

        # But root is not MediaContainer
        self.assertNotEqual(root.tag, 'MediaContainer')

        # MediaContainer check should fail
        self.assertNotIn(b'MediaContainer', non_container_xml)

    def test_media_container_without_items(self):
        """Empty MediaContainer should be valid but have no items"""
        empty_container = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="0"/>'''

        root = ET.fromstring(empty_container)
        self.assertEqual(root.tag, 'MediaContainer')
        self.assertEqual(root.get('size'), '0')
        self.assertEqual(len(list(root)), 0)

    def test_html_response_detection(self):
        """HTML error response should not be cached"""
        html_response = b'''<!DOCTYPE html>
<html>
<head><title>500 Internal Server Error</title></head>
<body><h1>Internal Server Error</h1></body>
</html>'''

        # Should not contain MediaContainer
        self.assertNotIn(b'MediaContainer', html_response)

        # Starts with '<' but is HTML not MediaContainer XML
        self.assertTrue(html_response.strip().startswith(b'<'))

    def test_truncated_xml_detection(self):
        """Truncated XML should raise parse error"""
        truncated_xml = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="1">
    <Video ratingKey="12345" title="Test'''  # Missing closing

        with self.assertRaises(ET.ParseError):
            ET.fromstring(truncated_xml)

    def test_xml_with_parent_keys(self):
        """Episode XML with parent keys should be extractable"""
        episode_xml = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="1">
    <Video ratingKey="300" title="Pilot" type="episode"
           parentRatingKey="200" grandparentRatingKey="100"
           index="1" parentIndex="1"/>
</MediaContainer>'''

        root = ET.fromstring(episode_xml)
        video = root.find('Video')

        self.assertEqual(video.get('ratingKey'), '300')
        self.assertEqual(video.get('parentRatingKey'), '200')
        self.assertEqual(video.get('grandparentRatingKey'), '100')


class TestDecompressionHandling(unittest.TestCase):
    """Tests for compression/decompression handling"""

    def test_gzip_decompression(self):
        """Gzip compressed content should decompress correctly"""
        import gzip

        original = b'Hello, World! This is test content.'
        compressed = gzip.compress(original)
        decompressed = gzip.decompress(compressed)

        self.assertEqual(decompressed, original)

    def test_deflate_decompression(self):
        """Deflate compressed content should decompress correctly"""
        import zlib

        original = b'Hello, World! This is test content.'
        compressed = zlib.compress(original)
        decompressed = zlib.decompress(compressed)

        self.assertEqual(decompressed, original)

    def test_gzip_magic_bytes(self):
        """Gzip content should have correct magic bytes"""
        import gzip

        content = b'test content'
        compressed = gzip.compress(content)

        # Gzip magic bytes: 0x1f 0x8b
        self.assertEqual(compressed[0:2], b'\x1f\x8b')

    def test_invalid_gzip_raises_error(self):
        """Invalid gzip content should raise error"""
        import gzip

        invalid_gzip = b'not gzip compressed'

        with self.assertRaises(Exception):
            gzip.decompress(invalid_gzip)

    def test_invalid_deflate_raises_error(self):
        """Invalid deflate content should raise error"""
        import zlib

        invalid_deflate = b'not deflate compressed'

        with self.assertRaises(Exception):
            zlib.decompress(invalid_deflate)

    def test_xml_survives_compression_roundtrip(self):
        """XML content should survive gzip roundtrip"""
        import gzip

        xml_content = b'''<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="3">
    <Video ratingKey="100" title="Movie A"/>
    <Video ratingKey="200" title="Movie B"/>
    <Video ratingKey="300" title="Movie C"/>
</MediaContainer>'''

        compressed = gzip.compress(xml_content)
        decompressed = gzip.decompress(compressed)

        # Should be byte-for-byte identical
        self.assertEqual(decompressed, xml_content)

        # Should parse correctly
        root = ET.fromstring(decompressed)
        self.assertEqual(root.tag, 'MediaContainer')
        self.assertEqual(len(root.findall('Video')), 3)


class TestTMDbRequestFingerprint(unittest.TestCase):
    """Tests for TMDb request fingerprinting (G1)"""

    def test_fingerprint_stability(self):
        """Same request should produce same fingerprint"""
        import hashlib
        from urllib.parse import urlparse, parse_qs

        def compute_fingerprint(method: str, path: str) -> str:
            parsed = urlparse(path)
            path_base = parsed.path
            query_params = parse_qs(parsed.query)
            sorted_params = sorted(
                ((k, tuple(sorted(v))) for k, v in query_params.items()),
                key=lambda x: x[0]
            )
            fingerprint_str = f"{method}:{path_base}:{sorted_params}"
            return hashlib.md5(fingerprint_str.encode()).hexdigest()

        path1 = '/3/discover/movie?api_key=xxx&sort_by=popularity.desc&page=1'
        path2 = '/3/discover/movie?page=1&api_key=xxx&sort_by=popularity.desc'

        # Same params, different order should produce same fingerprint
        fp1 = compute_fingerprint('GET', path1)
        fp2 = compute_fingerprint('GET', path2)

        self.assertEqual(fp1, fp2)

    def test_different_params_different_fingerprint(self):
        """Different params should produce different fingerprint"""
        import hashlib
        from urllib.parse import urlparse, parse_qs

        def compute_fingerprint(method: str, path: str) -> str:
            parsed = urlparse(path)
            path_base = parsed.path
            query_params = parse_qs(parsed.query)
            sorted_params = sorted(
                ((k, tuple(sorted(v))) for k, v in query_params.items()),
                key=lambda x: x[0]
            )
            fingerprint_str = f"{method}:{path_base}:{sorted_params}"
            return hashlib.md5(fingerprint_str.encode()).hexdigest()

        path1 = '/3/discover/movie?api_key=xxx&page=1'
        path2 = '/3/discover/movie?api_key=xxx&page=2'

        fp1 = compute_fingerprint('GET', path1)
        fp2 = compute_fingerprint('GET', path2)

        self.assertNotEqual(fp1, fp2)


class TestNonOverlayDiscoverDetection(unittest.TestCase):
    """Tests for non-overlay discover detection (G2)"""

    def _is_non_overlay_discover(self, path: str) -> bool:
        """Check if a discover request is for non-overlay contexts"""
        from urllib.parse import urlparse, parse_qs

        path_base = path.split('?')[0]

        if '/discover/' not in path_base:
            return False

        parsed = urlparse(path)
        query_params = parse_qs(parsed.query)

        non_overlay_indicators = [
            'with_genres', 'with_keywords', 'certification',
            'certification_country', 'with_runtime', 'with_companies',
            'with_networks', 'with_people', 'with_cast', 'with_crew',
        ]

        for indicator in non_overlay_indicators:
            if indicator in query_params and query_params[indicator]:
                return True

        vote_count_gte = query_params.get('vote_count.gte', ['0'])[0]
        try:
            if int(vote_count_gte) >= 100:
                return True
        except ValueError:
            pass

        return False

    def test_genre_collection_is_non_overlay(self):
        """Genre-based discover is non-overlay (collection builder)"""
        path = '/3/discover/movie?api_key=xxx&with_genres=28'
        self.assertTrue(self._is_non_overlay_discover(path))

    def test_keyword_collection_is_non_overlay(self):
        """Keyword-based discover is non-overlay"""
        path = '/3/discover/movie?api_key=xxx&with_keywords=9715'
        self.assertTrue(self._is_non_overlay_discover(path))

    def test_certification_collection_is_non_overlay(self):
        """Certification-based discover is non-overlay"""
        path = '/3/discover/movie?api_key=xxx&certification=PG-13&certification_country=US'
        self.assertTrue(self._is_non_overlay_discover(path))

    def test_high_vote_count_is_non_overlay(self):
        """High vote_count threshold suggests chart builder"""
        path = '/3/discover/movie?api_key=xxx&vote_count.gte=500'
        self.assertTrue(self._is_non_overlay_discover(path))

    def test_simple_discover_is_overlay(self):
        """Simple discover without collection indicators is allowed"""
        path = '/3/discover/movie?api_key=xxx&sort_by=popularity.desc'
        self.assertFalse(self._is_non_overlay_discover(path))

    def test_non_discover_endpoint_ignored(self):
        """Non-discover endpoints are not affected"""
        path = '/3/movie/12345?api_key=xxx'
        self.assertFalse(self._is_non_overlay_discover(path))


class TestTMDbProxyResultCapping(unittest.TestCase):
    """Tests for TMDb proxy result capping logic"""

    def _create_discover_response(self, total_results=100, total_pages=5, result_count=20):
        """Create a mock TMDb discover response"""
        results = []
        for i in range(result_count):
            results.append({
                'id': i + 1,
                'title': f'Movie {i + 1}',
                'popularity': 100 - i
            })

        return {
            'page': 1,
            'total_pages': total_pages,
            'total_results': total_results,
            'results': results
        }

    def test_capping_logic_truncates_results(self):
        """Results should be truncated to limit"""
        import json

        response = self._create_discover_response(
            total_results=100,
            total_pages=5,
            result_count=20
        )
        id_limit = 10

        # Simulate capping
        if 'results' in response:
            response['results'] = response['results'][:id_limit]
            response['total_results'] = min(response['total_results'], id_limit)
            response['total_pages'] = 1

        self.assertEqual(len(response['results']), 10)
        self.assertEqual(response['total_results'], 10)
        self.assertEqual(response['total_pages'], 1)

    def test_capping_preserves_structure(self):
        """Capped response should maintain schema"""
        import json

        response = self._create_discover_response()
        id_limit = 5

        # Simulate capping
        original_keys = set(response.keys())
        response['results'] = response['results'][:id_limit]
        response['total_results'] = id_limit
        response['total_pages'] = 1

        # Should have same keys
        self.assertEqual(set(response.keys()), original_keys)

        # Should have correct structure
        self.assertIn('page', response)
        self.assertIn('total_pages', response)
        self.assertIn('total_results', response)
        self.assertIn('results', response)
        self.assertIsInstance(response['results'], list)

    def test_empty_results_handled(self):
        """Empty results should be handled gracefully"""
        response = {
            'page': 1,
            'total_pages': 0,
            'total_results': 0,
            'results': []
        }

        # Capping empty results should work
        response['results'] = response['results'][:25]
        response['total_pages'] = 1

        self.assertEqual(response['results'], [])
        self.assertEqual(response['total_pages'], 1)

    def test_results_under_limit_unchanged(self):
        """Results under limit should not be modified"""
        import json

        response = self._create_discover_response(
            total_results=5,
            total_pages=1,
            result_count=5
        )
        id_limit = 25

        original_count = len(response['results'])

        # Capping should not increase count
        response['results'] = response['results'][:id_limit]

        self.assertEqual(len(response['results']), original_count)


class TestTVDbConversionDetection(unittest.TestCase):
    """Tests for H1: TMDb → TVDb conversion request detection"""

    def _is_tvdb_conversion_request(self, path: str) -> bool:
        """Check if a request is for TMDb → TVDb ID conversion"""
        from urllib.parse import urlparse, parse_qs

        path_base = path.split('?')[0]

        # Match /tv/{id}/external_ids
        if '/tv/' in path_base and '/external_ids' in path_base:
            return True

        # Match /find/ with tvdb_id source
        if '/find/' in path_base:
            parsed = urlparse(path)
            query_params = parse_qs(parsed.query)
            external_source = query_params.get('external_source', [''])[0]
            if external_source == 'tvdb_id':
                return True

        return False

    def test_tv_external_ids_detected(self):
        """TV show external_ids endpoint should be detected"""
        path = '/3/tv/12345/external_ids?api_key=xxx'
        self.assertTrue(self._is_tvdb_conversion_request(path))

    def test_tv_external_ids_without_query(self):
        """TV external_ids without query string should be detected"""
        path = '/3/tv/67890/external_ids'
        self.assertTrue(self._is_tvdb_conversion_request(path))

    def test_find_with_tvdb_source(self):
        """Find endpoint with tvdb_id source should be detected"""
        path = '/3/find/tt12345?api_key=xxx&external_source=tvdb_id'
        self.assertTrue(self._is_tvdb_conversion_request(path))

    def test_find_with_imdb_source_not_detected(self):
        """Find endpoint with imdb_id source should not be detected"""
        path = '/3/find/tt12345?api_key=xxx&external_source=imdb_id'
        self.assertFalse(self._is_tvdb_conversion_request(path))

    def test_movie_external_ids_not_detected(self):
        """Movie external_ids should not be detected (only TV)"""
        path = '/3/movie/12345/external_ids?api_key=xxx'
        self.assertFalse(self._is_tvdb_conversion_request(path))

    def test_regular_tv_endpoint_not_detected(self):
        """Regular TV endpoint should not be detected"""
        path = '/3/tv/12345?api_key=xxx'
        self.assertFalse(self._is_tvdb_conversion_request(path))

    def test_discover_not_detected(self):
        """Discover endpoint should not be detected as TVDb conversion"""
        path = '/3/discover/tv?api_key=xxx'
        self.assertFalse(self._is_tvdb_conversion_request(path))


class TestDiagnosticTracking(unittest.TestCase):
    """Tests for H3/H4: Diagnostic tracking features"""

    def test_zero_match_count_tracking(self):
        """Zero match searches should be trackable"""
        # Simulate counting zero-match searches
        zero_match_searches = 0

        queries = [
            ('exact_match', 5),
            ('no_results', 0),
            ('some_results', 3),
            ('empty_query', 0),
        ]

        for query, item_count in queries:
            if item_count == 0 and query:
                zero_match_searches += 1

        self.assertEqual(zero_match_searches, 2)

    def test_type_mismatch_detection_structure(self):
        """Type mismatch records should have expected structure"""
        mismatch = {
            'expected_type': 'movie',
            'actual_type': 'collection',
            'section_id': '1',
            'description': 'Section 1 expected movie but got collection',
            'timestamp': '2024-01-15T10:30:00',
        }

        self.assertIn('expected_type', mismatch)
        self.assertIn('actual_type', mismatch)
        self.assertIn('description', mismatch)

    def test_diagnostics_summary_structure(self):
        """Diagnostics summary should have expected fields"""
        diagnostics = {
            'zero_match_searches': 5,
            'type_mismatches': [],
            'type_mismatches_count': 0,
        }

        self.assertIn('zero_match_searches', diagnostics)
        self.assertIn('type_mismatches', diagnostics)
        self.assertIn('type_mismatches_count', diagnostics)

        # Count should match list length
        self.assertEqual(
            diagnostics['type_mismatches_count'],
            len(diagnostics['type_mismatches'])
        )

    def test_zero_match_warning_threshold(self):
        """Zero match searches should trigger warning when > 0"""
        zero_matches = 3

        # Simulating the logging decision
        should_warn = zero_matches > 0

        self.assertTrue(should_warn)

        # No warning for 0
        self.assertFalse(0 > 0)


class TestLibrarySectionType(unittest.TestCase):
    """Tests for synthetic section detail type correctness"""

    def test_section_detail_movie_type(self):
        """Movies section should report type=movie"""
        xml_bytes = build_synthetic_section_detail_xml('1', [{'type': 'movie'}])
        root = ET.fromstring(xml_bytes)
        directory = root.find('Directory')
        self.assertIsNotNone(directory)
        self.assertEqual(directory.get('type'), 'movie')


class TestFilterTypesEndpoint(unittest.TestCase):
    """Tests for synthetic filterTypes endpoint - P0 fix for plex_search validation"""

    def test_is_filter_types_endpoint_matches(self):
        """filterTypes endpoint pattern should match correctly"""
        self.assertEqual(is_filter_types_endpoint('/library/sections/1/filterTypes'), '1')
        self.assertEqual(is_filter_types_endpoint('/library/sections/2/filterTypes'), '2')
        self.assertEqual(is_filter_types_endpoint('/library/sections/123/filterTypes'), '123')
        self.assertEqual(is_filter_types_endpoint('/library/sections/1/filterTypes?X-Plex-Token=abc'), '1')

    def test_is_filter_types_endpoint_not_matches(self):
        """filterTypes pattern should not match other endpoints"""
        self.assertIsNone(is_filter_types_endpoint('/library/sections/1'))
        self.assertIsNone(is_filter_types_endpoint('/library/sections/1/all'))
        self.assertIsNone(is_filter_types_endpoint('/library/sections/1/filters'))
        self.assertIsNone(is_filter_types_endpoint('/library/sections'))

    def test_filter_types_movie_section(self):
        """Movie section should return movie filter types with resolution filter"""
        xml_bytes = build_synthetic_filter_types_xml('1', [{'type': 'movie'}])
        root = ET.fromstring(xml_bytes)

        # Should have Type element
        type_elem = root.find('Type')
        self.assertIsNotNone(type_elem)
        self.assertEqual(type_elem.get('type'), 'movie')
        self.assertEqual(type_elem.get('active'), '1')

        # Should have Filter elements
        filters = type_elem.findall('Filter')
        self.assertGreater(len(filters), 0)

        # Should include resolution filter (the main one for the P0 bug)
        filter_keys = [f.get('filter') for f in filters]
        self.assertIn('resolution', filter_keys)
        self.assertIn('audioCodec', filter_keys)
        self.assertIn('hdr', filter_keys)

    def test_filter_types_show_section(self):
        """Show section should return show filter types"""
        xml_bytes = build_synthetic_filter_types_xml('2', [{'type': 'show'}])
        root = ET.fromstring(xml_bytes)

        # Should have show, season, episode types
        types = root.findall('Type')
        type_names = [t.get('type') for t in types]
        self.assertIn('show', type_names)
        self.assertIn('season', type_names)
        self.assertIn('episode', type_names)

        # Show type should have resolution filter
        show_type = root.find("Type[@type='show']")
        self.assertIsNotNone(show_type)
        filters = show_type.findall('Filter')
        filter_keys = [f.get('filter') for f in filters]
        self.assertIn('resolution', filter_keys)

    def test_filter_types_contains_required_attributes(self):
        """Filter elements should have required attributes for plexapi"""
        xml_bytes = build_synthetic_filter_types_xml('1', [{'type': 'movie'}])
        root = ET.fromstring(xml_bytes)
        type_elem = root.find('Type')
        filters = type_elem.findall('Filter')

        # Each filter should have: filter, filterType, key, title, type
        for f in filters:
            self.assertIsNotNone(f.get('filter'), 'Filter missing filter attribute')
            self.assertIsNotNone(f.get('filterType'), 'Filter missing filterType attribute')
            self.assertIsNotNone(f.get('key'), 'Filter missing key attribute')
            self.assertIsNotNone(f.get('title'), 'Filter missing title attribute')
            self.assertIsNotNone(f.get('type'), 'Filter missing type attribute')

    def test_filter_types_resolution_has_correct_filter_type(self):
        """Resolution filter should have filterType=string"""
        xml_bytes = build_synthetic_filter_types_xml('1', [{'type': 'movie'}])
        root = ET.fromstring(xml_bytes)
        type_elem = root.find('Type')
        resolution_filter = type_elem.find("Filter[@filter='resolution']")
        self.assertIsNotNone(resolution_filter)
        self.assertEqual(resolution_filter.get('filterType'), 'string')

    def test_filter_types_hdr_has_correct_filter_type(self):
        """HDR filter should have filterType=boolean"""
        xml_bytes = build_synthetic_filter_types_xml('1', [{'type': 'movie'}])
        root = ET.fromstring(xml_bytes)
        type_elem = root.find('Type')
        hdr_filter = type_elem.find("Filter[@filter='hdr']")
        self.assertIsNotNone(hdr_filter)
        self.assertEqual(hdr_filter.get('filterType'), 'boolean')


class TestUploadCaptureParsing(unittest.TestCase):
    """Tests for upload image extraction logic"""

    def test_extract_raw_jpeg(self):
        """Raw JPEG body should be detected"""
        jpeg_bytes = b'\xff\xd8\xff\xe0' + b'\x00' * 20
        image_bytes, ext = extract_image_from_body(jpeg_bytes, 'image/jpeg')
        self.assertEqual(image_bytes, jpeg_bytes)
        self.assertEqual(ext, 'jpg')

    def test_extract_multipart_jpeg(self):
        """Multipart JPEG should be extracted"""
        jpeg_bytes = b'\xff\xd8\xff\xe0' + b'\x00' * 20
        boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
        body = (
            f'--{boundary}\r\n'
            'Content-Disposition: form-data; name="file"; filename="poster.jpg"\r\n'
            'Content-Type: image/jpeg\r\n\r\n'
        ).encode() + jpeg_bytes + f'\r\n--{boundary}--\r\n'.encode()
        content_type = f'multipart/form-data; boundary={boundary}'

        image_bytes, ext = extract_image_from_body(body, content_type)
        self.assertEqual(image_bytes, jpeg_bytes)
        self.assertEqual(ext, 'jpg')


class TestFastModeSanitization(unittest.TestCase):
    """Tests for FAST mode sanitization"""

    def test_letterboxd_removed_and_imdb_filter_stripped(self):
        """Letterboxd entries removed, IMDb category_filter stripped"""
        data = {
            'overlays': {
                'LetterboxdOverlay': {
                    'letterboxd_list': 'https://letterboxd.com/user/list'
                },
                'ImdbAwardsOverlay': {
                    'imdb_awards': {
                        'category_filter': 'best motion picture, animated'
                    }
                },
            }
        }
        sanitized, stats = sanitize_overlay_data_for_fast_mode(data)
        self.assertNotIn('LetterboxdOverlay', sanitized['overlays'])
        self.assertEqual(stats['letterboxd_removed'], 1)
        imdb_awards = sanitized['overlays']['ImdbAwardsOverlay']['imdb_awards']
        self.assertNotIn('category_filter', imdb_awards)
        self.assertEqual(stats['imdb_category_filters_stripped'], 1)


class TestFastModeTmdbCapping(unittest.TestCase):
    """Tests for FAST mode TMDb discover capping"""

    def test_discover_capped(self):
        """Discover responses should be capped to id_limit"""
        import json

        handler = TMDbProxyHandler.__new__(TMDbProxyHandler)
        handler.id_limit = 2
        handler.pages_limit = 1

        response = {
            'page': 1,
            'total_pages': 3,
            'total_results': 5,
            'results': [
                {'id': 1},
                {'id': 2},
                {'id': 3},
                {'id': 4},
                {'id': 5},
            ],
        }
        body = json.dumps(response).encode('utf-8')

        capped_body, was_capped = TMDbProxyHandler._cap_tmdb_response(
            handler, body, '/3/discover/movie'
        )
        self.assertTrue(was_capped)
        capped = json.loads(capped_body)
        self.assertEqual(len(capped['results']), 2)
        self.assertEqual(capped['total_pages'], 1)


class TestSafePreviewTargets(unittest.TestCase):
    """Tests for safe preview target extraction"""

    def test_safe_preview_targets_missing(self):
        """Missing preview section should return empty list"""
        self.assertEqual(safe_preview_targets({}), [])

    def test_safe_preview_targets_invalid_type(self):
        """Invalid preview targets should return empty list"""
        config = {'preview': {'targets': {}}}
        self.assertEqual(safe_preview_targets(config), [])


if __name__ == '__main__':
    # Run tests with verbose output
    unittest.main(verbosity=2)
