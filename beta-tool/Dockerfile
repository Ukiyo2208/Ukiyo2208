FROM python:3.12-slim-bookworm

# Outils de conversion : FFmpeg (vidéo/audio), LibreOffice (bureautique), Pandoc (texte),
# Calibre (e-books), Poppler (PDF), librsvg (SVG), Ghostscript + Tesseract (compression et OCR des PDF)
# + polices compatibles Microsoft Office
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg pandoc poppler-utils librsvg2-bin calibre \
        ghostscript tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng unpaper pngquant \
        libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
        fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -U -r requirements.txt
COPY *.py ./
COPY static ./static

ENV DOWNLOAD_DIR=/downloads CONVERT_DIR=/converted PDF_DIR=/pdf DATA_DIR=/data WORK_DIR=/work PORT=8080 PYTHONUNBUFFERED=1 \
    QT_QPA_PLATFORM=offscreen QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox
EXPOSE 8080
CMD ["python", "app.py"]
