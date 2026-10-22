# M11 DA3 depth — the GPU step (Colab)

This is the **only** part of M11 that needs a GPU. Everything else (wall-plane fit,
hold frames, height maps, records, validation) runs locally on CPU.

## What you do
1. Open [Google Colab](https://colab.research.google.com), new notebook.
2. **Runtime → Change runtime type → GPU** (free T4 is enough for our images).
3. Upload `da3_inference.py` (from this folder) and your wall images.

## Colab cells

```python
# 1. Install DA3 + deps. --ignore-requires-python works around DA3's over-strict
#    "requires-python <=3.13" (PEP 440 reads it as <=3.13.0, rejecting Colab's 3.13.x).
!pip -q install --ignore-requires-python "git+https://github.com/ByteDance-Seed/Depth-Anything-3.git" pillow numpy
# DA3 under-declares some runtime deps — install them explicitly.
!pip -q install addict omegaconf einops timm safetensors huggingface_hub
```

```python
# 2. Get images onto the box. Either upload a zip and unzip:
from google.colab import files
up = files.upload()                      # choose images.zip
!unzip -q images.zip -d /content/images
# ...or mount Drive:  from google.colab import drive; drive.mount('/content/drive')
```

```python
# 3. Run DA3 → metric-depth .npz per image
!python da3_inference.py --images /content/images --out /content/depth
```

```python
# 4. Zip the outputs and download
!cd /content && zip -qr depth.zip depth
from google.colab import files
files.download('/content/depth.zip')
```

## Back on your Mac
Unzip `depth.zip`, then build the hold-depth records locally (no GPU):

```bash
./.venv/bin/python backend/scripts/build_depth_records.py \
  --depth-dir /path/to/depth --gyms bh sm bh-phone
```

That stitches each image's DA3 depth with M9 holds + M10 colors through the M11
geometry pipeline and writes records to `backend/artifacts/depth/<scan>/`.

## Notes
- Which images? For a first validation, the labeled gym images (`data/bh`, `sm`,
  `bh-phone`). For the full dataset, any scan — holds come from the M9 detector.
- Focal length: read from EXIF when present, else a 26 mm-equivalent default (the
  script records which, and flags defaults as lower-confidence downstream).
- Verify the DA3 package name / entry point against the repo if the pinned version
  changes; the metric formula `focal_px * net_output / 300` is from the model card.
