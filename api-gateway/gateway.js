const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: '*', // Allow all origins (you can restrict this later)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Route /auth → auth-service:3000
app.use('/auth', createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true
}));

// Route /restaurant → restaurant-service:3001
app.use('/restaurant', createProxyMiddleware({
  target: 'http://localhost:3001',
  changeOrigin: true
}));


app.use('/checklist', createProxyMiddleware({
  target: 'http://localhost:3002',
  changeOrigin: true
}));

app.use('/employee', createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true
}));

// Start the server
app.listen(5000, () => console.log('API Gateway running on http://localhost:5000'));
