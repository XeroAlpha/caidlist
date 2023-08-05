module.exports = {
    env: {
        commonjs: true,
        es2021: true,
        node: true
    },
    extends: [
        'airbnb-base'
    ],
    parserOptions: {
        ecmaVersion: 'latest'
    },
    plugins: [
        '@html-eslint',
        'html'
    ],
    rules: {
        indent: ['error', 4, {
            SwitchCase: 1,
            VariableDeclarator: 1,
            outerIIFEBody: 1,
            FunctionDeclaration: {
                parameters: 1,
                body: 1
            },
            FunctionExpression: {
                parameters: 1,
                body: 1
            },
            CallExpression: {
                arguments: 1
            },
            ArrayExpression: 1,
            ObjectExpression: 1,
            ImportDeclaration: 1,
            flatTernaryExpressions: false,
            ignoredNodes: ['JSXElement', 'JSXElement > *', 'JSXAttribute', 'JSXIdentifier', 'JSXNamespacedName', 'JSXMemberExpression', 'JSXSpreadAttribute', 'JSXExpressionContainer', 'JSXOpeningElement', 'JSXClosingElement', 'JSXFragment', 'JSXOpeningFragment', 'JSXClosingFragment', 'JSXText', 'JSXEmptyExpression', 'JSXSpreadChild'],
            ignoreComments: false
        }],
        'no-console': 'off',
        'max-len': 'off',
        'comma-dangle': ['error', 'never'],
        'no-plusplus': 'off',
        'no-param-reassign': ['error', { props: false }],
        'object-curly-newline': ['error', { multiline: true, consistent: true }],
        'no-await-in-loop': 'off',
        'no-debugger': 'off',
        'no-underscore-dangle': 'off',
        'import/no-dynamic-require': 'off',
        'no-restricted-syntax': ['off', {
            selector: 'ForOfStatement'
        }],
        'no-continue': 'off',
        'no-multi-assign': ['error', { ignoreNonDeclaration: true }],
        'no-cond-assign': ['error', 'except-parens'],
        'no-return-assign': ['error', 'except-parens'],
        'no-nested-ternary': 'off',
        'import/extensions': ['error', 'ignorePackages'],
        'import/no-extraneous-dependencies': ['error', {
            devDependencies: ['script/*.js']
        }],
        'max-classes-per-file': 'off'
    },
    overrides: [
        {
            files: ['*.html'],
            parser: '@html-eslint/parser',
            extends: ['plugin:@html-eslint/recommended'],
            env: {
                browser: true,
                es2021: true
            }
        }
    ],
    settings: {
        'import/resolver': {
            node: {
                readPackageSync(readFileSync, pkgfile) {
                    const body = readFileSync(pkgfile);
                    try {
                        const pkg = JSON.parse(body);
                        if (typeof pkg.exports === 'string') {
                            pkg.main = pkg.exports;
                        }
                        return pkg;
                    } catch (jsonErr) { /* ignored */ }
                    return null;
                }
            }
        }
    }
};
