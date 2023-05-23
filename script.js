const express = require('express');
const speedTest = require('speedtest-net');

const app = express();
const port = 3000;

app.get('/speed', (req, res) => {
  const test = speedTest({ maxTime: 5000 }); // Set the maximum time for the speed test in milliseconds

  test.on('data', data => {
    const downloadSpeed = data.speeds.download;
    res.json({ downloadSpeed });
  });

  test.on('error', err => {
    console.error('Speed test error:', err);
    res.status(500).json({ error: 'An error occurred during the speed test' });
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
