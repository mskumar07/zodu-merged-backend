const RequestValidator = async (schema, body) => {
  try {
    const value = await schema.validateAsync(body, { abortEarly: false, stripUnknown: true });
    return { errors: false, input: value };
  } catch (validationError) {
    const errors = validationError.details.map(err => err.message).join(", ");
    return { errors, input: null };
  }
};

module.exports = RequestValidator;
