const { ValidationError } = require('./error/errors');

// Validates and returns the cleaned value, or throws a 400 listing every problem.
const validate = (schema, value) => {
  const { error, value: clean } = schema.validate(value, { abortEarly: false, stripUnknown: true });
  if (error) throw ValidationError(error.details.map((d) => d.message).join(', '));
  return clean;
};

module.exports = validate;
