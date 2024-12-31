import js from '@eslint/js';
import html from 'eslint-plugin-html';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default [
    js.configs.recommended,
    prettier,
    {
        files: ['**/*.html'],
        plugins: { html },
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser
            }
        }
    },
    {
        ignores: ['output/*'],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    }
];
