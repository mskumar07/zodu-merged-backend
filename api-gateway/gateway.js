require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const AUTH_SERVICE_URL       = process.env.AUTH_SERVICE_URL       || 'http://auth-service:4000';
const RETAIL_SERVICE_URL     = process.env.RETAIL_SERVICE_URL     || 'http://retail-service:4001';
const EMPLOYEE_SERVICE_URL   = process.env.EMPLOYEE_SERVICE_URL   || 'http://employee-service:4002';
const RESTAURANT_SERVICE_URL = process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:4003';

const proxyError = (serviceName) => (err, req, res) => {
  console.error(`[${serviceName}] proxy error:`, err.message);
  res.status(502).json({ error: `${serviceName} unavailable` });
};

app.use('/auth', createProxyMiddleware({
  target: AUTH_SERVICE_URL,
  changeOrigin: true,
  on: { error: proxyError('auth-service') }
}));

app.use('/retail', createProxyMiddleware({
  target: RETAIL_SERVICE_URL,
  changeOrigin: true,
  on: { error: proxyError('retail-service') }
}));

app.use('/employee', createProxyMiddleware({
  target: EMPLOYEE_SERVICE_URL,
  changeOrigin: true,
  secure: false,
  autoRewrite: true,
  encodePathChars: false,
  on: { error: proxyError('employee-service') }
}));

app.use('/restaurant', createProxyMiddleware({
  target: RESTAURANT_SERVICE_URL,
  changeOrigin: true,
  secure: false,
  autoRewrite: true,
  encodePathChars: false,
  on: { error: proxyError('restaurant-service') }
}));

app.get('/', (req, res) => {
  res.send('Welcome to the API Gateway!');
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`API Gateway running on port ${PORT}`));
