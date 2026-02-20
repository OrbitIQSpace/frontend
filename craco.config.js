// craco.config.js
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

const cesiumBuild = 'node_modules/cesium/Build/Cesium';

module.exports = {
  webpack: {
    plugins: {
      add: [
        new CopyWebpackPlugin({
          patterns: [
            // Copy the pre-built Cesium bundle so index.html can load it
            // as a plain script tag — keeps Webpack out of the equation entirely
            {
              from: path.join(cesiumBuild, 'Cesium.js'),
              to: 'cesium/Cesium.js'
            },
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

      // Tell Webpack to treat 'cesium' as an external global loaded via script tag.
      // This stops Webpack from trying to bundle/parse Cesium.js, which pulls in
      // urijs internals (IPv6, SecondLevelDomains, punycode) that Webpack
      // cannot resolve in a standard CRA setup.
      webpackConfig.externals = {
        ...webpackConfig.externals,
        cesium: 'Cesium',
        'cesium/Build/Cesium/Cesium': 'Cesium'
      };

      return webpackConfig;
    }
  }
};