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



// Route /auth → localhost:3000
app.use('/auth', createProxyMiddleware({
  target: 'http://localhost:4000',
  changeOrigin: true
}));

// Route /restaurant → localhost:3001
app.use('/restaurant', createProxyMiddleware({
  target: 'http://localhost:4001',
  changeOrigin: true
}));

app.use('/employee', createProxyMiddleware({
  target: 'http://localhost:4002',
  changeOrigin: true
}));

app.use("/", (req, res) => {
  res.send("Welcome to the API Gateway!");
  
});

// Start the server
app.listen(5001, () => console.log('API Gateway running on http://localhost:5001'));
