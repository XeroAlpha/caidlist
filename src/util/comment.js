export const CommentLocation = {
    beforeAll() {
        return Symbol.for('before-all');
    },
    before(prop) {
        if (prop !== undefined) {
            return Symbol.for(`before:${prop}`);
        }
        return Symbol.for('before');
    },
    afterProp(prop) {
        return Symbol.for(`after-prop:${prop}`);
    },
    afterColon(prop) {
        return Symbol.for(`after-colon:${prop}`);
    },
    afterValue(prop) {
        return Symbol.for(`after-value:${prop}`);
    },
    after(prop) {
        if (prop !== undefined) {
            return Symbol.for(`after:${prop}`);
        }
        return Symbol.for('after');
    },
    afterAll() {
        return Symbol.for('after-all');
    }
};

const clPropKeyPrefixes = ['before', 'after-prop', 'after-colon', 'after-value', 'after'];
const clPropKey = ['before-all', 'before', 'after', 'after-all'];
export function extractCommentLocation(symbol) {
    const key = Symbol.keyFor(symbol);
    if (!key) return undefined;
    const colonPos = key.indexOf(':');
    if (colonPos >= 0) {
        const type = key.slice(0, colonPos);
        const prop = key.slice(colonPos + 1);
        if (clPropKeyPrefixes.includes(type)) {
            return { type, prop };
        }
    } else if (clPropKey.includes(key)) {
        return { type: key };
    }
    return undefined;
}

function parseJSONComment(type, comment) {
    return {
        type: type === 'block' || type === 'inlineBlock' ? 'BlockComment' : 'LineComment',
        value: comment,
        inline: type === 'inlineBlock' || type === 'inlineLine'
    };
}

export function setJSONComment(target, symbol, type, comment) {
    target[symbol] = [parseJSONComment(type, comment)];
}

export function clearJSONComment(target, symbol) {
    delete target[symbol];
}

export function addJSONComment(target, symbol, type, comment) {
    const comments = target[symbol];
    if (Array.isArray(comments)) {
        comments.push(parseJSONComment(type, comment));
    } else {
        setJSONComment(target, symbol, type, comment);
    }
}

export function copyJSONComment(source, sourceSymbol, target, targetSymbol) {
    const sourceComments = source[sourceSymbol];
    const targetComments = target[targetSymbol];
    if (sourceComments) {
        if (targetComments) {
            targetComments.push(...sourceComments);
        } else {
            target[targetSymbol] = [...sourceComments];
        }
    }
}

export function moveJSONComment(source, sourceSymbol, target, targetSymbol) {
    copyJSONComment(source, sourceSymbol, target, targetSymbol);
    clearJSONComment(source, sourceSymbol);
}
