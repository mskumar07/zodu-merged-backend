"""Face embedding service for face-recognition attendance.

Stateless: it turns one photo into one 512-d ArcFace embedding (InsightFace
buffalo_l). Storing and matching embeddings is employee-service's job, so
this container holds no data and can be restarted or scaled freely.
"""

import os

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile
from insightface.app import FaceAnalysis

# Faces scored below this by the detector are background noise, not people.
MIN_DET_SCORE = float(os.getenv("FACE_MIN_DET_SCORE", "0.6"))
# A second face at least this fraction of the main face's area means two
# people are in frame, and we can't tell whose attendance it is.
SECOND_FACE_AREA_RATIO = 0.6

app = FastAPI()

# Loaded once at start-up; only detection + recognition are needed.
face_app = FaceAnalysis(
    name="buffalo_l",
    allowed_modules=["detection", "recognition"],
    providers=["CPUExecutionProvider"],
)
face_app.prepare(ctx_id=-1, det_size=(640, 640))


def _area(face) -> float:
    x1, y1, x2, y2 = face.bbox
    return float(max(0, x2 - x1) * max(0, y2 - y1))


def _detect(img):
    """Faces in [img], trying each rotation — phone photos can arrive
    sideways when the camera only records orientation in EXIF."""
    for rotation in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180,
                     cv2.ROTATE_90_COUNTERCLOCKWISE):
        frame = img if rotation is None else cv2.rotate(img, rotation)
        faces = [f for f in face_app.get(frame) if f.det_score >= MIN_DET_SCORE]
        if faces:
            return faces
    return []


@app.get("/")
@app.get("/health")
def health_check():
    return {"status": "Face service running"}


@app.post("/embedding")
async def generate_embedding(file: UploadFile = File(...)):
    contents = await file.read()
    img = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return {"success": False, "reason": "invalid_image"}

    faces = sorted(_detect(img), key=_area, reverse=True)
    if not faces:
        return {"success": False, "reason": "no_face"}
    if len(faces) > 1 and _area(faces[1]) >= _area(faces[0]) * SECOND_FACE_AREA_RATIO:
        return {"success": False, "reason": "multiple_faces"}

    face = faces[0]
    return {
        "success": True,
        # L2-normalised, so cosine similarity is a plain dot product.
        "embedding": face.normed_embedding.tolist(),
        "det_score": float(face.det_score),
    }
