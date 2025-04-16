'use strict';

const build = require('@microsoft/sp-build-web');

build.addSuppression(`Warning - [sass] The local CSS class 'ms-Grid' is not camelCase and will not be type-safe.`);

var getTasks = build.rig.getTasks;
build.rig.getTasks = function () {
  var result = getTasks.call(build.rig);

  result.set('serve', result.get('serve-deprecated'));

  return result;
};

build.configureWebpack.mergeConfig({
  additionalConfiguration: (generatedConfiguration) => {
    generatedConfiguration.module.rules.push(
      {
        test: /\.js$/,
        exclude: /node_modules\/(?!htmlparser2)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    );

    // Add resolve.symlinks configuration to help with case sensitivity issues
    if (!generatedConfiguration.resolve) {
      generatedConfiguration.resolve = {};
    }
    
    // Set to false to correctly resolve paths with different casing
    generatedConfiguration.resolve.symlinks = false;
    
    // Optionally add this if you still have issues
    generatedConfiguration.resolve.alias = {
      ...generatedConfiguration.resolve.alias,
      // Fix paths to ensure consistent casing
      'SharePointSSOComponent': __dirname
    };
    
    return generatedConfiguration;
  }
});

build.initialize(require('gulp'));
