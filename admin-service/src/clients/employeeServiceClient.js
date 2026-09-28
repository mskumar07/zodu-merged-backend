const { createServiceClient } = require('./baseServiceClient');
const { SERVICES } = require('../config');

const http = createServiceClient('employee', SERVICES.employee);

module.exports = {
  getUserStats: (params) => http.get('/internal/admin/users/stats', { params }).then((r) => r.data.data),
};
