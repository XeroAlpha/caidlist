import { createToken, CstParser, Lexer } from 'chevrotain';

/**
 * @param {RegExp} regex
 * @param {(match: RegExpExecArray) => any} f
 * @returns {import('chevrotain').CustomPatternMatcherFunc}
 */
function withPayload(regex, f) {
    const pattern = new RegExp(regex.source, `${regex.flags.replace(/y/g, '')}y`);
    return (text, offset) => {
        pattern.lastIndex = offset;
        const match = pattern.exec(text);
        if (match !== null) {
            match.payload = f(match);
        }
        return match;
    };
}

const Literal = createToken({
    name: 'Literal',
    pattern: withPayload(
        /nil|false|true/,
        ([match]) => {
            if (match === 'nil') {
                return null;
            }
            if (match === 'false') {
                return false;
            }
            if (match === 'true') {
                return true;
            }
            throw new Error(`Unexpected literal: ${match}`);
        }
    ),
    line_breaks: false
});
const Numeral = createToken({
    name: 'Numeral',
    pattern: withPayload(
        /([+-]?\d+)(?:\.(\d+))?(?:[Ee]([+-]?\d+))?/,
        ([match]) => parseFloat(match)
    ),
    line_breaks: false
});
const HexadecimalNumeral = createToken({
    name: 'HexadecimalNumeral',
    pattern: withPayload(
        /([+-]?)0[Xx]([\da-fA-F]+)(?:\.([\da-fA-F]+))?(?:[Pp]([+-])?([\da-fA-F]+))?/,
        ([, sign, base, frac, expSign, exp]) => {
            let number = parseInt(base, 16);
            if (frac) {
                number += parseInt(frac, 16) / (16 ** frac.length);
            }
            if (exp) {
                const factor = 2 ** parseInt(exp, 16);
                if (expSign === '-') {
                    number /= factor;
                } else {
                    number *= factor;
                }
            }
            if (sign === '-') {
                number = -number;
            }
            return number;
        }
    ),
    line_breaks: false
});
const NumberalLiteral = createToken({
    name: 'NumberalLiteral',
    pattern: withPayload(
        /([+-]?[01])\s*\/\s*0/,
        ([, num]) => parseInt(num, 10) / 0
    ),
    line_breaks: false
});
const EscapeMap = {
    a: '\x07',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    z: '' // Not supported
};
function StringPayloadMatcher([stringLiteral]) {
    const content = stringLiteral.slice(1, -1);
    return content.replace(
        /\\(?:x([0-9a-fA-F]{2})|([0-9]{1,3})|u\{([0-9a-fA-F]{1,})\}|([^]))/g,
        (_, escapeHex, escapeDec, escapeUnicode, escapeAny) => {
            if (escapeHex) {
                return String.fromCharCode(parseInt(escapeHex, 16));
            }
            if (escapeDec) {
                return String.fromCharCode(parseInt(escapeDec, 10));
            }
            if (escapeUnicode) {
                return String.fromCharCode(parseInt(escapeUnicode, 16));
            }
            return escapeAny in EscapeMap ? EscapeMap[escapeAny] : escapeAny;
        }
    );
}
const DoubleQuoteString = createToken({
    name: 'DoubleQuoteString',
    pattern: withPayload(
        /"(?:[^\\\n"]|\\(?:x[0-9a-fA-F]{2}|[0-9]{1,3}|u\{[0-9a-fA-F]{1,}\}|[^]))*"/,
        StringPayloadMatcher
    ),
    line_breaks: true
});
const SingleQuoteString = createToken({
    name: 'SingleQuoteString',
    pattern: withPayload(
        /'(?:[^\\\n']|\\(?:x[0-9a-fA-F]{2}|[0-9]{1,3}|u\{[0-9a-fA-F]{1,}\}|[^]))*'/,
        StringPayloadMatcher
    ),
    line_breaks: true
});
const MultilineString = createToken({
    name: 'MultilineString',
    pattern: withPayload(
        /\[([=]*)\[([^]*?)\]\1\]/,
        ([, content]) => content
    ),
    line_breaks: true
});
const Name = createToken({
    name: 'Name',
    pattern: /[A-Za-z_][A-Za-z_0-9]*/,
    line_breaks: false
});
const WhiteSpace = createToken({
    name: 'WhiteSpace',
    pattern: /[ \t\n\r]+/,
    group: Lexer.SKIPPED
});
const BlockComment = createToken({
    name: 'BlockComment',
    pattern: /--\[\[([^]*?)\]\]/,
    line_breaks: true,
    group: Lexer.SKIPPED
});
const LineComment = createToken({
    name: 'LineComment',
    pattern: /--(.*)/,
    group: Lexer.SKIPPED
});
const TableBegin = createToken({
    name: 'TableBegin',
    pattern: /\{/
});
const TableEnd = createToken({
    name: 'TableEnd',
    pattern: /\}/
});
const FieldBegin = createToken({
    name: 'FieldBegin',
    pattern: /\[/
});
const FieldEnd = createToken({
    name: 'FieldEnd',
    pattern: /\]/
});
const FieldAssign = createToken({
    name: 'FieldAssign',
    pattern: /=/
});
const FieldSeperator = createToken({
    name: 'FieldSeperator',
    pattern: /,|;/
});

const Tokens = [
    WhiteSpace,
    BlockComment,
    LineComment,
    HexadecimalNumeral,
    NumberalLiteral,
    Numeral,
    DoubleQuoteString,
    SingleQuoteString,
    MultilineString,
    TableBegin,
    TableEnd,
    FieldBegin,
    FieldAssign,
    FieldSeperator,
    FieldEnd,
    Literal,
    Name
];

export const lsonLexer = new Lexer(Tokens);

class LSONParser extends CstParser {
    constructor(config) {
        super(Tokens, config);

        const $ = this;
        $.RULE('expression', () => {
            $.OR([
                { ALT: () => $.SUBRULE($.primitive) },
                { ALT: () => $.SUBRULE($.tableConstructor) }
            ]);
        });
        $.RULE('primitive', () => {
            $.OR([
                { ALT: () => $.CONSUME(HexadecimalNumeral) },
                { ALT: () => $.CONSUME(NumberalLiteral) },
                { ALT: () => $.CONSUME(Numeral) },
                { ALT: () => $.CONSUME(DoubleQuoteString) },
                { ALT: () => $.CONSUME(SingleQuoteString) },
                { ALT: () => $.CONSUME(MultilineString) },
                { ALT: () => $.CONSUME(Literal) }
            ]);
        });
        $.RULE('tableConstructor', () => {
            $.CONSUME(TableBegin);
            $.OPTION(() => {
                $.SUBRULE($.field);
                $.MANY(() => {
                    $.CONSUME(FieldSeperator);
                    $.SUBRULE2($.field);
                });
                $.OPTION2(() => {
                    $.CONSUME2(FieldSeperator);
                });
            });
            $.CONSUME(TableEnd);
        });
        $.RULE('field', () => {
            $.OR([{
                ALT: () => {
                    $.CONSUME(FieldBegin);
                    $.SUBRULE($.primitive);
                    $.CONSUME(FieldEnd);
                    $.CONSUME(FieldAssign);
                    $.SUBRULE($.expression);
                }
            }, {
                ALT: () => {
                    $.CONSUME(Name);
                    $.CONSUME2(FieldAssign);
                    $.SUBRULE2($.expression);
                }
            }, {
                ALT: () => {
                    $.SUBRULE3($.expression);
                }
            }]);
        });

        this.performSelfAnalysis();
    }
}

export const lsonParser = new LSONParser();

/**
 * @param {import('chevrotain').CstNode} node
 */
function visitNode(node) {
    const { name, children } = node;
    if (name === 'expression') {
        if (children.tableConstructor) {
            return visitNode(children.tableConstructor[0]);
        }
        return visitNode(children.primitive[0]);
    }
    if (name === 'tableConstructor') {
        if (!children.field) {
            return [];
        }
        /** @type {[string | number | boolean | null | undefined, any][]} */
        const fields = children.field.map((e) => visitNode(e));
        const isArray = fields.every((e) => e[0] === undefined);
        if (isArray) {
            return fields.map((e) => e[1]);
        }
        const ret = {};
        let counter = 1;
        fields.forEach(([k, v]) => {
            if (k === undefined) {
                ret[counter] = v;
                counter++;
            } else {
                ret[k] = v;
            }
        });
        return ret;
    }
    if (name === 'primitive') {
        const token = children[Object.keys(children)[0]][0];
        return token.payload;
    }
    if (name === 'field') {
        const value = visitNode(children.expression[0]);
        let key;
        if (children.Name) {
            key = children.Name[0].image;
        } else if (children.primitive) {
            key = visitNode(children.primitive[0]);
        }
        return [key, value];
    }
    throw new Error(`Unknown CstNode: ${name}`);
}
export function parseLSON(str) {
    const lexResult = lsonLexer.tokenize(str);
    lsonParser.input = lexResult.tokens;
    const cst = lsonParser.expression();
    if (lsonParser.errors.length) {
        throw lsonParser.errors[0];
    }
    return visitNode(cst);
}
