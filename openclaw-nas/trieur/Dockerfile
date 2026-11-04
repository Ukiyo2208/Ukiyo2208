FROM python:3.12-slim

# pdftotext/pdftoppm (PDF) et tesseract en français (documents scannés)
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-fra \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY trieur.py web.py page.html ./
EXPOSE 8802
CMD ["python", "-u", "trieur.py"]
