const app      = require('./express-app');
const { PORT } = require('./config');

const port = PORT || 4004;

app.listen(port, () => {
  console.log(`🚀 Payroll service running on port ${port}`);
});
