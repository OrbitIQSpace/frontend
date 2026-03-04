// craco.config.js
module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.module.unknownContextCritical = false;
      webpackConfig.module.exprContextCritical = false;

      // Cesium is loaded as a global via <script> tag in index.html
      // so Webpack should not try to bundle it
      webpackConfig.externals = {
        ...webpackConfig.externals,
        cesium: 'Cesium',
        'cesium/Build/Cesium/Cesium': 'Cesium'
      };

      return webpackConfig;
    }
  }
};