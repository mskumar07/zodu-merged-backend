const { validate } = require("class-validator");

const ValidateError = async (input) => {
  const error = await validate(input, {
    validationError: { target: true, property: true },
  });

  if (error.length) {
    return error.map((err) => ({
      field: err.property,
      message:
        (err.constraints && Object.values(err.constraints)[0]) ||
        "please provide input for this field",
    }));
  }
  return false;
};

module.exports = { ValidateError };
