from fastapi import FastAPI, UploadFile, File
import numpy as np
import cv2
from insightface.app import FaceAnalysis

app = FastAPI()

# Load model once when container starts
face_app = FaceAnalysis(name="buffalo_l")
face_app.prepare(ctx_id=-1)  # CPU mode for VPS


@app.get("/")
def health_check():
    return {"status": "Face service running"}


@app.post("/embedding")
async def generate_embedding(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return {"success": False, "error": "Invalid image"}

    faces = face_app.get(img)

    if not faces:
        return {"success": False}

    embedding = faces[0].embedding.tolist()

    return {"success": True, "embedding": embedding}