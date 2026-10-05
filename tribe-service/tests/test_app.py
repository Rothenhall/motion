import numpy as np
import pytest
from fastapi.testclient import TestClient

import app as service
import networks
from runner import ClipPrediction, per_second


class FakeRunner:
    loaded = True

    def __init__(self):
        self.calls = 0

    def load(self):
        pass

    def run(self, video, sound_off=True):
        self.calls += 1
        rng = np.random.default_rng(0)
        nets = {k: rng.normal(0, 1, 12) for k in networks.NETWORKS}
        words = [{"word": "hello", "start": 0.4, "duration": 0.3}, {"word": "there", "start": 1.2, "duration": 0.3}]
        muted = ClipPrediction(nets={k: v * 0.5 for k, v in nets.items()}) if sound_off else None
        vertices = rng.normal(0, 1, (12, networks.N_VERTICES)).astype(np.float32)
        return ClipPrediction(nets=nets, words=words, vertices=vertices), muted, True


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "CACHE_DIR", tmp_path)
    monkeypatch.setenv("TRIBE_SERVICE_TOKEN", "secret")
    monkeypatch.setenv("TRIBE_PRELOAD", "0")
    service.app.state.runner = FakeRunner()
    service.app.state.reference = None
    with TestClient(service.app) as c:
        yield c


def post(client, token="secret", name="reel.mp4", body=b"fake-video", sound_off="true", **extra):
    return client.post("/analyze", files={"file": (name, body, "video/mp4")}, data={"sound_off": sound_off, **extra}, headers={"Authorization": f"Bearer {token}"})


def test_requires_token(client):
    assert post(client, token="wrong").status_code == 401


def test_rejects_non_video(client):
    assert post(client, name="photo.jpg").status_code == 400
    assert post(client, body=b"").status_code == 400


def test_analyze_returns_scores_and_caches(client):
    res = post(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["seconds"] == 12
    assert body["scores"]["sound_off_resilience"] is not None
    assert body["scores"]["message_clarity"] is not None
    assert body["transcript"][0]["word"] == "hello"
    assert body["has_audio"] is True
    assert post(client).json() == body
    assert service.app.state.runner.calls == 1
    post(client, sound_off="false")
    assert service.app.state.runner.calls == 2


def test_brain_map_only_when_asked(client):
    assert "brain" not in post(client).json()
    brain = post(client, include_brain="true").json()["brain"]
    assert brain["shape"] == [12, networks.N_VERTICES] and brain["mesh"] == "fsaverage5"
    decoded = networks.decode_brain(brain)
    assert decoded.shape == (12, networks.N_VERTICES)
    lo, hi = brain["range"]
    assert lo <= decoded.min() and decoded.max() <= hi


def test_health(client):
    assert client.get("/health").json()["model_loaded"] is True


def test_per_second_places_segments_by_start_and_fills_gaps():
    class Seg:
        def __init__(self, start):
            self.start = start

    preds = np.array([[1.0], [3.0]])
    out = per_second(preds, [Seg(0.0), Seg(2.0)])
    assert out[:, 0].tolist() == [1.0, 1.0, 3.0]
