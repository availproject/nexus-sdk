const path = require('node:path');

module.exports = {
  entry: './src/index.ts',
  mode: 'production',
  cache: false, // Disable cache to prevent corruption issues
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      stream: false,
      http: false,
      https: false,
      zlib: false,
      path: false,
      os: false,
    },
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    library: {
      type: 'module',
    },
  },
  experiments: {
    outputModule: true,
  },
  optimization: {
    concatenateModules: false, // Disable to prevent JSON parsing errors with some packages
  },
};
