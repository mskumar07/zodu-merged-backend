export function parseAttachments(attachmentURL) {
  if (!attachmentURL) return [];

  try {
    const data = JSON.parse(attachmentURL);
    // Ensure it's an array
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("❌ Invalid attachment_url format:", err);
    return [];
  }
}
