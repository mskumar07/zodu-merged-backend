const Joi = require('joi');

// A calendar date from a screen: a date input sends "YYYY-MM-DD", the screen shows "DD-MM-YYYY"; both are accepted.
// Either way the value becomes "YYYY-MM-DD", and must be a real day (no 31-02-2026).
module.exports = Joi.string().trim().custom((value, helpers) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) || /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) return helpers.error('date.format');
  const iso = value.indexOf('-') === 4 ? value : `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return helpers.error('date.format');
  return iso;
}).messages({ 'date.format': '{{#label}} must be a valid date as DD-MM-YYYY' });
