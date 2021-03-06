// eslint-disable-next-line
module.exports = appInfo => {
  const config = {};

  // startups
  config.startups = {
    databaseInit: {
      path: 'version/databaseInitStartup',
      debounce: true,
    },
    databaseName: {
      path: 'version/databaseNameStartup',
    },
  };

  return config;
};
