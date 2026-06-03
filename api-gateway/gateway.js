require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: '*', // Allow all origins (you can restrict this later)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));



const AUTH_SERVICE_URL       = process.env.AUTH_SERVICE_URL       || 'http://auth-service:3000';
const RETAIL_SERVICE_URL = process.env.RETAIL_SERVICE_URL || 'http://retail-service:3001';
const EMPLOYEE_SERVICE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:3002';
const RESTAURANT_SERVICE_URL   = process.env.RESTAURANT_SERVICE_URL   || 'http://restaurant-service:3004';


app.use('/auth', createProxyMiddleware({
  target: AUTH_SERVICE_URL,
  changeOrigin: true
}));

app.use('/retail', createProxyMiddleware({
  target: RETAIL_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/retail': '' }
}));

app.use('/employee', createProxyMiddleware({
  target: EMPLOYEE_SERVICE_URL,
  changeOrigin: true
}));

app.use('/restaurant', createProxyMiddleware({
  target: RESTAURANT_SERVICE_URL,
  changeOrigin: true
}));

app.use("/", (req, res) => {
  res.send("Welcome to the API Gateway!");
  
});

// Start the server
const PORT = process.env.PORT || 5001;

console.log(PORT)

app.listen(PORT, () => console.log(`API Gateway running on http://localhost:${PORT}`));
