import('./src/server.js').catch((error) => {
  console.error(error);
  process.exit(1);
});
