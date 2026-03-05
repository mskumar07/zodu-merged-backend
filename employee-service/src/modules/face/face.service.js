const axios = require("axios");
const FormData = require("form-data");

class FaceService {

  async generateEmbedding(imageBuffer) {
    const formData = new FormData();
    formData.append("file", imageBuffer, {
      filename: "face.jpg"
    });

    const response = await axios.post(
      process.env.FACE_SERVICE_URL + "/embedding",
      formData,
      {
        headers: formData.getHeaders()
      }
    );

    if (!response.data.success) {
      throw new Error("Face not detected");
    }
    console.log(response.data.embedding);

    return response.data.embedding;
  }
}

module.exports = new FaceService();