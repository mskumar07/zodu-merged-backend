const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const repo = require('../repository/admin-user-repo');
const { APP_SECRET, JWT_EXPIRES_IN, ADMIN_TOKEN } = require('../config');
const { AuthorizeError, ValidationError } = require('../utils/error');

exports.login = async (email, password) => {
  if (!email || !password) throw ValidationError('email and password are required');

  const user = await repo.findByEmail(email.toLowerCase().trim());
  if (!user || !user.is_active) throw AuthorizeError('Invalid email or password');

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) throw AuthorizeError('Invalid email or password');

  await repo.touchLastLogin(user.id);

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    APP_SECRET,
    { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN, issuer: ADMIN_TOKEN.issuer, audience: ADMIN_TOKEN.audience }
  );

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
};

exports.getProfile = async (adminId) => {
  const user = await repo.findById(adminId);
  if (!user) throw AuthorizeError('Admin not found');
  return user;
};
