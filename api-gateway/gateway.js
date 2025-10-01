const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();

// Route /service1 → localhost:3000
app.use('/auth', createProxyMiddleware({ target: 'http://auth-service:3000', changeOrigin: true }));

// Route /service2 → localhost:3001
app.use('/restaurant', createProxyMiddleware({ target: 'http://restaurant-service:3001', changeOrigin: true }));

app.listen(8080, () => console.log('API Gateway running on http://localhost:8080'));
