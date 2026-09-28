const bcrypt = require('bcryptjs');
const repo = require('../repository/admin-user-repo');
const { ValidationError } = require('../utils/error');

// Field-presence/format checks live in schema/admin-user-schema.js, run by
// RequestValidator at the controller — this only does what a Joi schema
// can't: hashing the password and turning the DB's unique-email violation
// into a clean 400 instead of a raw Postgres error.
exports.list = () => repo.list();

exports.create = async ({ name, email, password, role }) => {
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    return await repo.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role,
    });
  } catch (err) {
    if (err.code === '23505') throw ValidationError('An admin with this email already exists');
    throw err;
  }
};
