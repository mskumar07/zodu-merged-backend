async function uploadMultiple(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files received");
  }

  const results = [];

  for (const file of files) {
    // Validate file
    if (!file || !file.buffer) {
      throw new Error("Invalid file received");
    }

    const uploaded = await uploadImg(file);

    if (!uploaded.success) {
      throw new Error(uploaded.message || "One or more file uploads failed");
    }

    results.push({
      id: Date.now() + "-" + Math.floor(Math.random() * 1000000),
      filename: file.originalname || `file-${Date.now()}`, // safe fallback
      url: uploaded.fileUrl,
      size: file.size || 0,
      mimetype: file.mimetype ?? "application/octet-stream",
    });
  }

  return results;
}