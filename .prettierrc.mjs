export default {
  plugins: ['prettier-plugin-svelte'],
  overrides: [
    {
      files: '*.{js,svelte,mjs,cjs}',
      options: {
        singleQuote: true,
      },
    },
    {
      // The markup keeps its whitespace exactly (svelte.config.mjs sets
      // preserveWhitespace), so formatting must never add or drop any.
      files: '*.svelte',
      options: {
        htmlWhitespaceSensitivity: 'strict',
      },
    },
  ],
};
