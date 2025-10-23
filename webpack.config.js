const path = require('path');

module.exports = {
  entry: './api/index.js', // Or the path to your server's entry file
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  target: 'node',
};