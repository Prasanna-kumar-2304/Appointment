require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const apiRoutes = require('./api');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;

// Fixed: Removed deprecated options
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Basic healthcheck
app.get('/', (req, res) => res.send('Medicare Backend is up'));

// API routes
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));