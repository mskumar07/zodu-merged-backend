// Calendar days are kept in India time (Asia/Kolkata), whatever zone the server runs in.

/** Today's date in India as "YYYY-MM-DD". */
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

module.exports = { istToday };
