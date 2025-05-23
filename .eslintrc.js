module.exports = {
  'env': {
    'browser': true,
    'es2021': true,
    'node': true,
    'jquery': true
  },
  'globals': {
    'chrome': 'readonly'
  },
  'extends': 'eslint:recommended',
  'overrides': [
  ],
  'parserOptions': {
    'ecmaVersion': 'latest',
    'sourceType': 'module'
  },
  'ignorePatterns': ['dist', 'tester-app'],
  'rules': {
    'indent': [
      'error',
      2,
      { 'VariableDeclarator': 'first' }
    ],
    'linebreak-style': [
      'error',
      'windows'
    ],
    'quotes': [
      'error',
      'single',
      { 
        'avoidEscape': true,
        'allowTemplateLiterals': true
      }
    ],
    'semi': 0,
    'eqeqeq': 'error',
    'no-trailing-spaces': 0,
    'object-curly-spacing': [
      'error', 'always'
    ],
    'arrow-spacing': [
      'error', { 'before': true, 'after': true }
    ],
    'no-console': 0,
    'prefer-destructuring': 0,
    'prop-types': 0,
    'object-property-newline': [
      'error', { 'allowAllPropertiesOnSameLine': true }
    ],
    'padded-blocks': 0,
    'no-unused-vars': 'warn',
    'no-empty': 'warn'
  }
}
