process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
// The fake auth-service also answers employee-service's user → employee lookup.
process.env.EMPLOYEE_SERVICE_URL = process.env.AUTH_SERVICE_URL;
