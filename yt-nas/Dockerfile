FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -U "yt-dlp[default]"
WORKDIR /app
COPY app.py .
COPY static ./static
ENV DOWNLOAD_DIR=/downloads PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "app.py"]
