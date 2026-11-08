
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 1024;

function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new Error(
      'Password must contain at least 6 characters'
    );
  }

  return password;
}

module.exports = { validatePassword };
