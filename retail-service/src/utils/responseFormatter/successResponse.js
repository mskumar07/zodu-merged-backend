const successResponse = (message, data = null, meta = null) => ({
  success: true,
  message,
  ...(data && { data }),
  ...(meta && { meta }),
});

module.exports = {
  successResponse,
};
