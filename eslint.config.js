// @ts-nocheck
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    ignores: ['src/app/api/**/*'], // Ignore auto-generated API files
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],

    processor: angular.processInlineTemplates,
    rules: {
      'max-len': 'off',
      quotes: 'off',
      semi: 'off',
      indent: 'off',
      'comma-dangle': 'off',
      'object-curly-spacing': 'off',
      'array-bracket-spacing': 'off',
      'space-before-function-paren': 'off',
      'keyword-spacing': 'off',
      'space-infix-ops': 'off',
      'eol-last': 'off',
      'no-trailing-spaces': 'off',
      'space-before-blocks': 'off',
      'object-curly-newline': 'off',
      'brace-style': 'off',

      // TypeScript-specific rules that conflict with prettier
      '@typescript-eslint/indent': 'off',
      '@typescript-eslint/quotes': 'off',
      '@typescript-eslint/semi': 'off',
      '@typescript-eslint/comma-dangle': 'off',
      '@typescript-eslint/object-curly-spacing': 'off',
      '@typescript-eslint/space-before-function-paren': 'off',
      '@typescript-eslint/keyword-spacing': 'off',
      '@typescript-eslint/space-infix-ops': 'off',
      '@typescript-eslint/brace-style': 'off',

      // Angular rules
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  }
);
