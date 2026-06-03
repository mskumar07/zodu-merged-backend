const generateReturnId = () => {
  const ts     = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RET-${ts}-${random}`;
};

module.exports = {
  generateReturnId,
};
