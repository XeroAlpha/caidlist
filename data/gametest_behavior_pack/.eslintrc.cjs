module.exports = {
    env: {
        commonjs: true,
        es2021: true,
        node: true
    },
    extends: ["airbnb-base"],
    parserOptions: {
        ecmaVersion: "latest"
    },
    rules: {
        indent: ["error", 4, { SwitchCase: 1 }],
        quotes: ["error", "double"],
        semi: ["error", "always"],
        "comma-dangle": ["error", "never"],
        "import/no-unresolved": ["error", { ignore: ["mojang-minecraft", "mojang-gametest", "@minecraft"] }]
    }
};
