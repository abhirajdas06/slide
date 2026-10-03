"""Thumbnail / slideshow-size generation so the gallery stays fast with 1000+ files."""
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

IMAGE_EXT = {'.jpg', '.jpeg', '.png'}
VIDEO_EXT = {'.mp4', '.webm', '.mov', '.m4v', '.ogv'}
THUMB_SIZE = 400
MEDIUM_SIZE = 1920
FFMPEG = shutil.which('ffmpeg')


def kind_for(filename):
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXT:
        return 'image'
    if ext in VIDEO_EXT:
        return 'video'
    return None


def _jpeg(img, size, quality):
    img = img.copy()
    img.thumbnail((size, size), Image.LANCZOS)
    if img.mode in ('RGBA', 'LA', 'P'):
        img = img.convert('RGBA')
        bg = Image.new('RGB', img.size, (0, 0, 0))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert('RGB')
    buf = BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    return ContentFile(buf.getvalue())


def process_image(item):
    item.file.open('rb')
    try:
        img = ImageOps.exif_transpose(Image.open(item.file))
        img.load()
    finally:
        item.file.close()
    stem = Path(item.file.name).stem
    item.thumb.save(f'{stem}.jpg', _jpeg(img, THUMB_SIZE, 78), save=False)
    item.medium.save(f'{stem}.jpg', _jpeg(img, MEDIUM_SIZE, 85), save=False)


def process_video(item):
    """Poster frame via ffmpeg if installed; otherwise the grid shows a video placeholder."""
    if not FFMPEG:
        return
    stem = Path(item.file.name).stem
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / 'poster.jpg'
        for ss in ('1', '0'):
            subprocess.run(
                [FFMPEG, '-y', '-ss', ss, '-i', item.file.path, '-frames:v', '1',
                 '-vf', f'scale={THUMB_SIZE}:-2', str(out)],
                capture_output=True, timeout=60)
            if out.exists() and out.stat().st_size:
                break
        if out.exists() and out.stat().st_size:
            item.thumb.save(f'{stem}.jpg', ContentFile(out.read_bytes()), save=False)
