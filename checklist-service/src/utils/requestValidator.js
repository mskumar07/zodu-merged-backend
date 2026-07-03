const RequestValidator = async (schema, body) => {
  try {
    const value = await schema.validateAsync(body, { abortEarly: false });
    return { errors: false, input: value };
  } catch (err) {
    const errors = err.details.map(d => d.message).join(', ');
    return { errors, input: null };
  }
};

module.exports = RequestValidator;
