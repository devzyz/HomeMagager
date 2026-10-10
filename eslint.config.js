import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/data/**',
      '**/artifacts/**',
      '**/private/**',
      '**/auto-imports.d.ts',
      '**/components.d.ts',
      '**/coverage/**',
      '**/tmp/**',
      '**/test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['apps/server/**/*.ts', 'apps/server/tests/**/*.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, sourceType: 'module' },
      globals: { ...globals.browser },
    },
  },
)
