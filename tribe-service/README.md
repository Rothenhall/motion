# Motion audience simulation service (TRIBE v2)

Runs Meta FAIR's [TRIBE v2](https://github.com/facebookresearch/tribev2) on a reel and returns
what Motion's pre-flight check needs: a per-second predicted attention curve, scores for the hook,
hold, faces, clarity, emotional pull and sound-off viewing, and flagged moments with timestamps.
No brain data leaves this service; the backend turns these numbers into plain advice with its AI reviewer.

> **License.** TRIBE v2 code and weights are CC BY-NC 4.0. This service is for internal R&D only.
> Do not put it in front of paying users without a commercial license from Meta.

## How it works

1. TRIBE v2 predicts average-viewer cortical activity, one row per second (20,484 points).
2. `networks.py` averages those points into 10 named systems using the HCP-MMP1 atlas
   (attention, visual motion, faces, scenes, reading, auditory, language, social, default mode, early visual).
3. The clip is run a second time with a silent soundtrack to estimate muted autoplay viewing.
4. `scoring.py` standardises each system against a reference library of reels (`reference.json`)
   or, without one, against the clip itself, and derives the scores and moments.

The attention curve is `mean(attention, visual motion, auditory, faces) − 0.5 × default mode`.
These are **uncalibrated estimates**: public attempts (see the research report) found no
significant link yet between TRIBE scores and real engagement. Treat them as directional until
they are calibrated against Motion's own post performance.

## Run it on Modal (serverless GPU, recommended)

```bash
cd tribe-service
pip install modal && modal setup                     # opens a browser login
modal secret create motion-tribe HF_TOKEN=hf_xxx TRIBE_SERVICE_TOKEN=some-long-secret
modal run modal_app.py::prefetch                     # one-time: weights + atlas into a Modal volume
modal deploy modal_app.py                            # prints https://<workspace>--motion-tribe-web.modal.run
```

Set `TRIBE_SERVICE_URL` to that URL and `TRIBE_SERVICE_TOKEN` to the same secret in `backend/.env`.
It runs on an A100 40 GB, scales to zero after 5 idle minutes and to at most 2 GPUs. The first request after
idling waits for a cold start while the model loads. Long analyses come back through Modal's 303 redirect,
which the backend follows.

## Run it on your own GPU

Needs an NVIDIA GPU with ~32 GB VRAM and a Hugging Face token approved for
[Llama 3.2-3B](https://huggingface.co/meta-llama/Llama-3.2-3B) (TRIBE uses it for words).

```bash
docker build -t motion-tribe .
docker run --gpus all -p 8000:8000 -v tribe-cache:/cache \
  -e HF_TOKEN=hf_xxx -e TRIBE_SERVICE_TOKEN=some-long-secret motion-tribe
```

The first start downloads ~20 GB of weights and the HCP atlas into the cache volume.
A 30 to 60 second reel takes roughly 1 to 9 minutes on an A100 (two passes: with and without sound).
Results are cached by file hash.

Then point the backend at it in `backend/.env`:

```
TRIBE_SERVICE_URL=http://gpu-box:8000
TRIBE_SERVICE_TOKEN=some-long-secret
```

Without `TRIBE_SERVICE_URL`, Motion's pre-flight check still works using the AI review of the frames, caption and script.

### Reference library (optional, recommended)

```bash
python build_reference.py --label "fitness reels" /data/reels/*.mp4   # writes reference.json
```

Mount it and set `TRIBE_REFERENCE_PATH=/cache/reference.json`. Scores then come with percentiles
("bottom 20% of fitness reels") instead of comparing a clip with itself.

## API

`POST /analyze` multipart `file` (video), `sound_off` (default `true`), header `Authorization: Bearer <TRIBE_SERVICE_TOKEN>`.

```jsonc
{
  "baseline": "clip",                 // or "library" when reference.json is loaded
  "seconds": 24,
  "curves": { "attention_index": [62, 58, ...], "faces": [...], "language": [...], ... },  // 0-100, 50 = typical
  "sound_off_attention": [55, 41, ...],
  "scores": { "hook": { "value": 34, "percentile": null, "z": -1.07 }, "hold": {...}, "sound_off_resilience": {...}, ... },
  "facts": { "first_face_second": 4, "short_clip": false, "speech_seconds": 18 },
  "moments": [{ "kind": "drop_risk", "start": 7, "end": 11, "level": 31 }, { "kind": "peak", ... }],
  "transcript": [{ "word": "Stop", "start": 0.4, "duration": 0.3 }],
  "has_audio": true, "model": "facebook/tribev2", "version": "1"
}
```

`GET /health` reports whether the model is loaded and which reference is in use.

## Tests

No GPU needed:

```bash
pip install -r requirements-dev.txt
python -m pytest tests
```
