module.exports = {
  /**
   * Application configuration section
   * http://omnitron.keymetrics.io/docs/usage/application-declaration/
   */
  apps: [
    {
      name: 'test-cluster',
      script: './echo.js',
      out_file: 'echo-out.log',
      error_file: 'echo-err.log',
      instances: 4,
    },
  ],
};
