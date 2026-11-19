module.exports = async () => {
  if (globalThis.__FAKE_AUTH__) globalThis.__FAKE_AUTH__.close();
};
