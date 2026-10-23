FROM python:3.13-slim
WORKDIR /bridge
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bridge.py .
ENV DATA_DIR=/data PORT=8099 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8099
CMD ["python", "bridge.py"]
