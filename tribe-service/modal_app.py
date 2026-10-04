"""Serverless GPU deployment of the audience simulation service on Modal (https://modal.com).

One-time setup (from this folder):
    pip install modal && modal setup
    modal secret create motion-tribe HF_TOKEN=hf_xxx TRIBE_SERVICE_TOKEN=<long random string>
    modal run modal_app.py::prefetch        # downloads ~20 GB of weights + the atlas into a volume

Deploy:
    modal deploy modal_app.py               # prints https://<workspace>--motion-tribe-web.modal.run

Then in backend/.env:
    TRIBE_SERVICE_URL=https://<workspace>--motion-tribe-web.modal.run
    TRIBE_SERVICE_TOKEN=<same token>

Containers scale to zero when idle, so you pay only while reels are analysed (plus a
cold start of a minute or two to load the model onto the GPU).
"""
import modal

GPU = "A100-40GB"  # TRIBE v2 needs ~28-32 GB of VRAM.
CACHE = "/cache"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install_from_requirements("requirements.txt")
    .env({"TRIBE_CACHE_DIR": CACHE, "HF_HOME": f"{CACHE}/hf", "TRIBE_REFERENCE_PATH": f"{CACHE}/reference.json"})
    .add_local_python_source("app", "networks", "runner", "scoring", "build_reference")
)
cache = modal.Volume.from_name("motion-tribe-cache", create_if_missing=True)
secret = modal.Secret.from_name("motion-tribe")

app = modal.App("motion-tribe", image=image)


@app.function(gpu=GPU, volumes={CACHE: cache}, secrets=[secret], timeout=30 * 60, scaledown_window=5 * 60, max_containers=2)
@modal.asgi_app()
def web():
    """The FastAPI service from app.py; the model loads on container start."""
    from app import app as fastapi_app

    return fastapi_app


@app.function(gpu=GPU, volumes={CACHE: cache}, secrets=[secret], timeout=60 * 60)
def prefetch():
    """Warm the volume so the first real request doesn't download the weights."""
    from runner import TribeRunner

    TribeRunner().load()
    cache.commit()
    print("weights and atlas cached")
