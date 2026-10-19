// Build-time settings. `environment` is 'test' in the test build
// (`vite build --mode test`), 'development' under `vite`, and 'production'
// in `vite build`.
const mode = import.meta.env.MODE;

export default {
  environment:
    mode === 'test'
      ? 'test'
      : import.meta.env.DEV
        ? 'development'
        : 'production',
  rootURL: '/',
  locationType: mode === 'test' ? 'none' : 'history',
};
