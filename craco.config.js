// craco.config.js
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

// Correct path for the 'cesium' npm package v1.x
const cesiumBuild = 'node_modules/cesium/Build/Cesium';

module.exports = {
  webpack: {
    plugins: {
      add: [
        new CopyWebpackPlugin({
          patterns: [
            {
              from: path.join(cesiumBuild, 'Assets'),
              to: 'cesium/Assets'
            },
            {
              from: path.join(cesiumBuild, 'Workers'),
              to: 'cesium/Workers'
            },
            {
              from: path.join(cesiumBuild, 'ThirdParty'),
              to: 'cesium/ThirdParty'
            },
            {
              from: path.join(cesiumBuild, 'Widgets'),
              to: 'cesium/Widgets'
            },
          ]
        })
      ]
    },
    configure: (webpackConfig) => {
      webpackConfig.module.unknownContextCritical = false;
      webpackConfig.module.exprContextCritical = false;
      return webpackConfig;
    }
  }
};