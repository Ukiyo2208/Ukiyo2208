FROM python:3.12-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Mêmes modèles que la tablette : les empreintes de visage sont compatibles
ADD https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx /modeles/
ADD https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx /modeles/

COPY app ./app

EXPOSE 8801
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8801"]
