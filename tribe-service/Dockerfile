# GPU image for the TRIBE v2 audience simulation service.
# Needs an NVIDIA GPU with ~32 GB VRAM (A100 40 GB or better) and the NVIDIA container runtime.
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
ENV TRIBE_CACHE_DIR=/cache HF_HOME=/cache/hf
VOLUME /cache
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
