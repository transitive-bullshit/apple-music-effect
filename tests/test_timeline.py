"""The committed timeline is one the renderer accepts, and the builder keeps it that way."""

import json

import pytest

from analysis import timeline


def test_committed_timeline_is_valid():
    timeline.validate(json.loads(timeline.OUT.read_text()))


def test_build_sorts_and_clips_beats():
    t = timeline.build(duration=2.0, beats=[1.5, 0.25, 2.5, -0.1, 0.2504], tempo=120.0, audio=None)
    assert t["beats"] == [0.25, 1.5]
    timeline.validate(t)


def test_validate_rejects_beats_out_of_order():
    with pytest.raises(ValueError):
        timeline.validate({"audio": None, "duration": 2.0, "tempo": 120.0, "beats": [1.0, 0.5]})
