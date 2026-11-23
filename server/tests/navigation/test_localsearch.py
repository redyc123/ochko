from urllib.parse import parse_qs, urlparse

import pytest

from navigation.geocode import GeocodeResult, NominatimClient, SearchOptions, _parse_entry
from navigation.localsearch import LocalSearch, LocalSearchError, LocationRequiredError


TYUMEN = {"lat": 57.153, "lon": 65.534}


def place(name, lat, lon):
    return GeocodeResult(displayName=name, lat=lat, lon=lon, type="bank", importance=0.5)


class FakeGeocoder:
    def __init__(self, responses=(), locality=None):
        self.responses = list(responses)
        self.locality = locality
        self.calls = []
        self.reverse_calls = []

    async def search(self, query, options=None):
        self.calls.append((query, options))
        response = self.responses.pop(0) if self.responses else []
        if isinstance(response, Exception):
            raise response
        return response

    async def reverse(self, lat, lon, zoom=18):
        self.reverse_calls.append((lat, lon, zoom))
        if isinstance(self.locality, Exception):
            raise self.locality
        return self.locality


async def test_local_search_stops_after_first_success_with_bounded_viewbox():
    geocoder = FakeGeocoder([[place("Банк, Тюмень", 57.16, 65.55)]])
    results = await LocalSearch(geocoder, 20_000).search("банк", TYUMEN)

    assert [result.displayName for result in results] == ["Банк, Тюмень"]
    assert len(geocoder.calls) == 1
    assert geocoder.calls[0][1].bounded is True
    assert geocoder.calls[0][1].viewbox is not None
    assert geocoder.reverse_calls == []


async def test_local_search_uses_locality_and_at_most_five_attempts():
    locality = place("Тюмень", 57.153, 65.534)
    locality.address = {"city": "Тюмень"}
    geocoder = FakeGeocoder(locality=locality)

    results = await LocalSearch(geocoder, 20_000).search("банк", TYUMEN)

    assert results == []
    assert len(geocoder.calls) == 5
    assert [call[0] for call in geocoder.calls[-2:]] == ["банк, Тюмень", "банк, Тюмень"]
    assert geocoder.calls[-2][1].bounded is True
    assert geocoder.calls[-1][1].bounded is False
    assert geocoder.reverse_calls == [(TYUMEN["lat"], TYUMEN["lon"], 10)]


async def test_local_search_sorts_deduplicates_and_rejects_other_cities():
    omsk = place("Банк, Омск", 55.0, 73.3667)
    farther = place("Банк на окраине, Тюмень", 57.25, 65.65)
    nearer = place("Банк рядом, Тюмень", 57.155, 65.54)
    malformed = place("", 57.15, 65.53)
    geocoder = FakeGeocoder([[omsk, farther, nearer, farther, malformed]])

    results = await LocalSearch(geocoder, 20_000).search("банк", TYUMEN)

    assert [result.displayName for result in results] == [nearer.displayName, farther.displayName]


async def test_local_search_reports_service_failure_after_retries():
    locality = place("Тюмень", 57.153, 65.534)
    locality.address = {"city": "Тюмень"}
    geocoder = FakeGeocoder([OSError("offline")] * 5, locality)

    with pytest.raises(LocalSearchError, match="повторите позже"):
        await LocalSearch(geocoder, 20_000).search("банк", TYUMEN)
    assert len(geocoder.calls) == 5


async def test_local_search_requires_position():
    with pytest.raises(LocationRequiredError):
        await LocalSearch(FakeGeocoder(), 20_000).search("банк", None)


def test_nominatim_urls_include_bounded_search_and_reverse_zoom():
    client = NominatimClient()
    search = parse_qs(urlparse(client.build_url("банк, Тюмень", SearchOptions((65.4, 57.1, 65.6, 57.2), bounded=True))).query)
    reverse = parse_qs(urlparse(client.build_reverse_url(57.153, 65.534, zoom=10)).query)

    assert search["bounded"] == ["1"]
    assert search["q"] == ["банк, Тюмень"]
    assert reverse["zoom"] == ["10"]
    assert reverse["addressdetails"] == ["1"]


def test_nominatim_discards_malformed_results():
    assert _parse_entry({"display_name": "", "lat": "57.1", "lon": "65.5"}) is None
    assert _parse_entry({"display_name": "Банк", "lat": "invalid", "lon": "65.5"}) is None
    assert _parse_entry({"display_name": "Банк", "lat": "57.1", "lon": "65.5"}) is not None
