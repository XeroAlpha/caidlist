/* eslint-disable consistent-return */
const AdmZip = require('adm-zip');
const { parse: parseHtml, TextNode, HTMLElement } = require('node-html-parser');
const CommentJSON = require('comment-json');
const prettier = require('prettier');
const { cachedOutput, filterObjectMap, forEachObject, deepCopy } = require('../util/common');
const { fetchFile, fetchRedirect } = require('../util/network');
const { CommentLocation, addJSONComment } = require('../util/comment');

const TemplatePackLink = {
    release: {
        behaviorPack: 'https://aka.ms/behaviorpacktemplate',
        resourcePack: 'https://aka.ms/resourcepacktemplate'
    },
    beta: {
        behaviorPack: 'https://aka.ms/MinecraftBetaBehaviors',
        resourcePack: 'https://aka.ms/MinecraftBetaResources'
    }
};

/**
 * Try every path in `pathList` until corresponding entry found
 * @param {import("adm-zip")} zip
 * @param {string[]} pathList
 */
function getEntryDataByPathList(zip, pathList, encoding) {
    for (const path of pathList) {
        const entry = zip.getEntry(path);
        if (entry) {
            const buffer = entry.getData();
            if (encoding) {
                return buffer.toString(encoding);
            }
            return buffer;
        }
    }
    throw new Error(`Cannot find entry by name: ${pathList.join(', ')}`);
}

const VersionRegExp = /Version:\s*([\d.]+)/;
function extractVersionString(zip) {
    const indexPageData = getEntryDataByPathList(zip, ['documentation/Index.html']);
    const versionMatch = VersionRegExp.exec(indexPageData.toString('utf-8'));
    if (!versionMatch) {
        throw new Error('Cannot find version title');
    }
    return versionMatch[1];
}

/**
 * @param {import("node-html-parser").Node} el
 */
function elText(el) {
    return el.text.trim().replace(/(?:\r\n|\r)/g, '\n');
}

/** @type {Map<string, (el: import("node-html-parser").Node, target: any) => string | undefined>} */
const BedrockDocStates = new Map();

function processDocStateMachine(elements, initialState, target) {
    let state = initialState;
    for (const element of elements) {
        const stateFunction = BedrockDocStates.get(state);
        const newState = stateFunction(element, target);
        if (newState) {
            state = newState;
        }
    }
    return target;
}

BedrockDocStates.set('end', () => undefined);
BedrockDocStates.set('initial', (el, { meta }) => {
    if (el instanceof HTMLElement && el.tagName === 'H1') {
        const match = /(.+?)\s*Version:\s*([\d.]+)/.exec(el.innerText.trim());
        [, meta.title, meta.version] = match;
        return 'index.title';
    }
});
BedrockDocStates.set('index.title', (el) => {
    if (el instanceof HTMLElement && el.tagName === 'H2' && el.innerText.trim() === 'Index') {
        return 'index.table';
    }
});
BedrockDocStates.set('index.table', (el, { meta, state }) => {
    if (el instanceof HTMLElement && el.tagName === 'TABLE') {
        const tableRows = el.querySelectorAll('tr > :is(th,td) > a');
        const sections = [];
        const content = [];
        meta.content = content;
        meta.sections = sections;
        state.indexedSections = tableRows.map((a) => ({
            name: a.text.trim(),
            href: a.getAttribute('href'),
            level: a.parentNode.tagName === 'TH' ? 1 : -1
        }));
        state.sectionStack = [{
            name: '(document root)',
            level: 0,
            sections,
            content
        }];
        return 'section';
    }
});
BedrockDocStates.set('section', (el, { state: { indexedSections, sectionStack } }) => {
    let content;
    if (el instanceof HTMLElement) {
        const level = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].indexOf(el.tagName);
        if (level >= 0) {
            let currentSection;
            const p = el.querySelector('p');
            if (p && p.id) {
                const sectionIndex = indexedSections.find((section) => section.href === `#${p.id}`);
                if (!sectionIndex) {
                    currentSection = {
                        name: elText(p),
                        level: level + 11,
                        content: []
                    };
                } else {
                    currentSection = {
                        name: sectionIndex.name,
                        level: sectionIndex.level === -1 ? 2 + level : sectionIndex.level,
                        content: []
                    };
                }
            } else {
                currentSection = {
                    name: elText(el),
                    level: 21 + level,
                    content: []
                };
            }
            if (currentSection.name.trim().length === 0) {
                return;
            }
            while (sectionStack.length) {
                if (sectionStack[0].level < currentSection.level) {
                    break;
                }
                sectionStack.shift();
            }
            if (!sectionStack[0].sections) {
                sectionStack[0].sections = [];
            }
            sectionStack[0].sections.push(currentSection);
            sectionStack.unshift(currentSection);
            return;
        }

        if (el.tagName === 'BR') {
            return;
        }
        if (el.tagName === 'A') {
            content = {
                type: 'link',
                content: elText(el),
                href: el.getAttribute('href')
            };
        } else if (el.tagName === 'TEXTAREA') {
            content = {
                type: 'code',
                content: elText(el)
            };
        } else if (el.tagName === 'TABLE') {
            const rows = [];
            processDocStateMachine(el.childNodes, 'table.row', {
                columnNames: [],
                rows
            });
            content = {
                type: 'table',
                rows
            };
        } else {
            console.warn(`Unexpected tag: ${el.tagName}`);
            content = {
                type: el.tagName.toLowerCase(),
                content: elText(el)
            };
        }
        if (content.type || content.length) {
            sectionStack[0].content.push(content);
        }
    } else {
        content = elText(el);
    }
    if (content.length) {
        sectionStack[0].content.push(content);
    }
});
BedrockDocStates.set('table.row', (el, { columnNames, rows }) => {
    if (el instanceof HTMLElement && el.tagName === 'TR') {
        /** @type {HTMLElement[]} */
        const columnNodes = el.childNodes.filter((e) => e instanceof HTMLElement);
        const row = {};
        let isDataRow = false;
        for (let i = 0; i < columnNodes.length; i++) {
            if (columnNodes[i].tagName === 'TH') {
                columnNames[i] = elText(columnNodes[i]);
            } else {
                const columnName = columnNames[i];
                if (columnName) {
                    isDataRow = true;
                    if (columnNodes[i].childNodes.every((e) => e instanceof TextNode)) {
                        row[columnName] = elText(columnNodes[i]);
                    } else {
                        const cellRoot = {
                            name: '(cell root)',
                            level: 10,
                            content: []
                        };
                        processDocStateMachine(columnNodes[i].childNodes, 'section', {
                            state: {
                                indexedSections: [],
                                sectionStack: [cellRoot]
                            }
                        });
                        const sectionMapper = (section) => {
                            const mergedContent = [...section.content];
                            if (section.sections) {
                                mergedContent.push(...section.sections.map(sectionMapper));
                            }
                            return {
                                section: section.name,
                                content: mergedContent
                            };
                        };
                        row[columnName] = sectionMapper(cellRoot).content;
                    }
                }
            }
        }
        if (isDataRow) {
            rows.push(row);
        }
    }
});

const NormalTagNames = [
    'HTML', 'TITLE', 'HEAD', 'BODY',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'TABLE', 'TH', 'TR', 'TD',
    'A', 'P', 'BR',
    'TEXTAREA', 'OL', 'LI'
];
/** @param {string} htmlContent */
function cleanHtml(htmlContent) {
    return htmlContent.replace(/<a\b(?:.*?)>Back to top<\/a>/g, '')
        .replace(/```([^]*?)```/g, '<textarea>$1</textarea>')
        .replace(/<textarea\b(?:.*?)>([^]*?)<\/textarea>/g, (match, content) => {
            const escapedContent = content.replace(/<br\s*(?:\/)?\s*>/g, '\n')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            return `<textarea>${escapedContent}</textarea>`;
        })
        .replace(/<([\w]+)\b(?:.*?)>/g, (match, tagName) => {
            if (NormalTagNames.includes(tagName.toUpperCase())) {
                return match;
            }
            return `&lt;${tagName}&gt;`;
        });
}

function parseBedrockDoc(content) {
    const root = parseHtml(cleanHtml(content));
    const meta = {};
    processDocStateMachine(root.childNodes, 'initial', { meta, state: {} });
    return meta;
}

function parseBehaviorPack(pathOrData, cacheKey) {
    const zip = new AdmZip(pathOrData);
    const version = extractVersionString(zip);
    const map = { __VERSION__: version };
    for (const entry of zip.getEntries()) {
        const fn = entry.entryName;
        const fnMatch = /documentation\/(.+)\.html/i.exec(fn);
        if (fnMatch && fnMatch[1] !== 'Index') {
            const parsed = parseBedrockDoc(entry.getData().toString('utf-8'));
            cachedOutput(`${cacheKey}.${fnMatch[1].toLowerCase().replace(/\s/g, '_')}`, parsed);
            map[fnMatch[1]] = parsed;
        }
    }
    return map;
}

function findSection(node, sectionName, ...restNames) {
    const sections = node.sections || [];
    const section = sections.find((e) => e.name === sectionName);
    if (section) {
        if (restNames.length) {
            return findSection(section, ...restNames);
        }
        return section;
    }
    throw new Error(`Section not found: ${sectionName}`);
}

function contentToPlain(content) {
    if (Array.isArray(content)) {
        return content.filter((e) => typeof e === 'string')
            .join('\n');
    }
    return String(content);
}

function contentFirstLine(content) {
    return contentToPlain(content).split('\n')[0];
}

const TableColumnNames = {
    Schema: ['Name', 'Type', 'Description'],
    Options: ['Options', 'Description']
};
function generateSchema(content) {
    const schema = {
        description: contentFirstLine(content)
    };
    if (Array.isArray(content)) {
        const firstTable = content.find((e) => typeof e === 'object' && e.type === 'table');
        if (!firstTable) return;
        const firstRow = firstTable.rows[0];
        if (!firstRow) {
            throw new Error('Invalid table');
        }
        const columns = Object.keys(firstRow);
        const isTableType = (expectColumns) => expectColumns.every((e) => columns.includes(e));
        if (isTableType(TableColumnNames.Schema)) {
            schema.children = firstTable.rows.map((row) => ({
                name: row.Name,
                type: row.Type,
                defaultValue: row.Default || row['Default Value'],
                ...generateSchema(row.Description)
            }));
        } else if (isTableType(TableColumnNames.Options)) {
            schema.options = firstTable.rows.map((row) => ({
                name: row.Name,
                ...generateSchema(row.Description)
            }));
        } else {
            console.warn('Unexpected table');
        }
    }
    return schema;
}

function createSectionSummaryAnalyzer({ name, documentation, path, withSchema }) {
    return {
        name,
        documentation,
        extract(doc) {
            const section = findSection(doc, ...path);
            const result = {};
            section.sections.forEach((e) => {
                if (withSchema) {
                    result[e.name] = generateSchema(e.content);
                } else {
                    result[e.name] = contentFirstLine(e.content);
                }
            });
            return result;
        }
    };
}

function createSectionTableAnalyzer({
    name,
    documentation,
    path,
    tableIndex,
    idKey,
    descriptionKey,
    withSchema
}) {
    return {
        name,
        documentation,
        extract(doc) {
            const section = findSection(doc, ...path);
            const tables = section.content.filter((e) => typeof e === 'object' && e.type === 'table');
            const table = tables[tableIndex >= 0 ? tableIndex : tables.length + tableIndex];
            const result = {};
            table.rows.forEach((row) => {
                const id = contentToPlain(row[idKey]);
                if (withSchema) {
                    result[id] = generateSchema(row[descriptionKey]);
                } else {
                    result[id] = contentFirstLine(row[descriptionKey]);
                }
            });
            return result;
        }
    };
}

const pageAnalyzer = [
    createSectionSummaryAnalyzer({
        name: 'entityFilter',
        documentation: 'Entities',
        path: ['Filters']
    }),
    createSectionSummaryAnalyzer({
        name: 'entityBehavior',
        documentation: 'Entities',
        path: ['Server Entity Documentation', 'AI Goals'],
        withSchema: true
    }),
    createSectionSummaryAnalyzer({
        name: 'entityAttribute',
        documentation: 'Entities',
        path: ['Server Entity Documentation', 'Attributes'],
        withSchema: true
    }),
    createSectionTableAnalyzer({
        name: 'entityBuiltinEvent',
        documentation: 'Entities',
        path: ['Server Entity Documentation', 'Built-in Events'],
        tableIndex: 0,
        idKey: 'Name',
        descriptionKey: 'Description'
    }),
    createSectionSummaryAnalyzer({
        name: 'entityComponent',
        documentation: 'Entities',
        path: ['Server Entity Documentation', 'Components'],
        withSchema: true
    }),
    createSectionSummaryAnalyzer({
        name: 'entityProperty',
        documentation: 'Entities',
        path: ['Server Entity Documentation', 'Properties'],
        withSchema: true
    }),
    createSectionSummaryAnalyzer({
        name: 'entityTrigger',
        documentation: 'Entities',
        path: ['Server Entity Documentation', 'Triggers']
    }),
    createSectionSummaryAnalyzer({
        name: 'featureType',
        documentation: 'Features',
        path: ['Supported features']
    }),
    createSectionTableAnalyzer({
        name: 'molangQuery',
        documentation: 'Molang',
        path: ['Domain Examples', 'List of Entity Queries'],
        tableIndex: 0,
        idKey: 'Name',
        descriptionKey: 'Description'
    }),
    createSectionTableAnalyzer({
        name: 'molangQuery',
        documentation: 'Molang',
        path: ['Domain Examples', 'List of Experimental Entity Queries'],
        tableIndex: 0,
        idKey: 'Name',
        descriptionKey: 'Description'
    })
];

function extractDocumentationIds(docMap) {
    const target = {};
    pageAnalyzer.forEach((analyzer) => {
        const doc = docMap[analyzer.documentation];
        if (!doc) {
            throw new Error(`Documentation not found: ${analyzer.documentation}`);
        }
        const extractResult = analyzer.extract(doc);
        if (analyzer.name in target) {
            Object.assign(target[analyzer.name], extractResult);
        } else {
            target[analyzer.name] = extractResult;
        }
    });
    return target;
}

async function fetchDocumentationIds(cx) {
    const { version } = cx;
    const cacheKey = `version.common.documentation.${version}`;
    let cache = cachedOutput(cacheKey);
    try {
        const behaviorPackUrl = await fetchRedirect(TemplatePackLink[version].behaviorPack);
        if (!cache || cache.__URL__ !== behaviorPackUrl) {
            const behaviorPackData = await fetchFile(behaviorPackUrl);
            const behaviorPackParsed = parseBehaviorPack(behaviorPackData, cacheKey);
            cache = cachedOutput(cacheKey, {
                __VERSION__: behaviorPackParsed.__VERSION__,
                __URL__: behaviorPackUrl,
                ...extractDocumentationIds(behaviorPackParsed)
            });
        }
    } catch (err) {
        if (!cache) {
            throw err;
        }
        console.error(`Failed to fetch template behavior pack, use cache instead: ${err}`);
    }
    return filterObjectMap(cache, (k) => !(k.startsWith('__') && k.endsWith('__')));
}

/**
 * @param {(type: string, schemaNode: { type?: string, description: string }, path: string[]) => void} f
 */
function visitSchema(schema, f, stack) {
    const iteratorStack = stack || [];
    if (typeof schema === 'object') {
        f('node', schema, iteratorStack);
        if (schema.children) {
            schema.children.forEach((e) => {
                visitSchema(e, f, [...iteratorStack, e.name]);
            });
        }
        if (schema.options) {
            schema.options.forEach((e) => {
                f('option', e, [...iteratorStack, e.name]);
            });
        }
    } else {
        f('node', { description: schema }, iteratorStack);
    }
}

function tryParseJSON(str, defaultValue) {
    try {
        return JSON.parse(str);
    } catch (err) { /* ignore */ }
    return defaultValue;
}

function getDefaultValue(schema) {
    switch (schema.type) {
        case 'Boolean':
            return schema.defaultValue === 'true';
        case 'Decimal':
        case 'Integer':
        case 'Positive Integer':
            return Number(schema.defaultValue) || 0;
        case 'String':
        case 'Molang':
            return String(schema.defaultValue);
        case 'Array':
            return [];
        case 'JSON Object':
            return {};
        case 'Range [a, b]':
            return tryParseJSON(schema.defaultValue, 0);
        case 'Vector [a, b, c]':
            return tryParseJSON(schema.defaultValue, [0, 0, 0]);
        case 'List':
            return [];
        case 'Minecraft Filter':
        case 'Trigger':
        case 'Item Description Properties':
            return {};
        case undefined:
            if (schema.children) {
                return {};
            }
            return schema.defaultValue !== undefined ? schema.defaultValue : null;
        default:
            throw new Error(`Unknown type: ${schema.type}`);
    }
}

function generateTypedJSON(schema, name, target) {
    if (!(name in target)) {
        target[name] = getDefaultValue(schema);
    }
    if (schema.type) {
        addJSONComment(target, CommentLocation.afterColon(name), 'inlineBlock', ` ${schema.type} `);
    }
    if (schema.description) {
        addJSONComment(target, CommentLocation.before(name), 'line', ` ${schema.description}`);
    }
    if (schema.children) {
        let parent = target[name];
        if (typeof parent !== 'object' || parent == null) {
            console.warn(`Unexpected non-object type: ${name}`);
            parent = {};
        }
        if (Array.isArray(parent)) {
            parent = parent[0] = {};
        }
        schema.children.forEach((child) => {
            generateTypedJSON(child, child.name, parent);
        });
    } else {
        const descSymbol = CommentLocation.after(name);
        if (schema.options) {
            schema.options.forEach((option) => {
                addJSONComment(target, descSymbol, ` ${option.name} - ${option.description}`);
            });
        }
    }
}

function doSchemaTranslation(schemaMap, onTranslate) {
    const flatMap = {};
    forEachObject(schemaMap, (schema, mapKey) => {
        visitSchema(schema, (type, schemaNode, path) => {
            const k = path.join('|>');
            if (k in flatMap) {
                console.warn(`Duplicated path: ${k}`);
            }
            flatMap[k] = schemaNode.description || '';
        }, [mapKey]);
    });
    const translatedFlatMap = onTranslate(flatMap, Object.keys(flatMap)) || flatMap;
    const translatedMap = {};
    forEachObject(schemaMap, (schema, mapKey) => {
        if (typeof schema === 'object') {
            const translatedSchema = deepCopy(schema);
            visitSchema(translatedSchema, (type, schemaNode, path) => {
                const k = path.join('|>');
                const v = translatedFlatMap[k];
                if (v) {
                    const match = /\{(.+?)\} (.+)/.exec(v);
                    if (match) {
                        [, schemaNode.type, schemaNode.description] = match;
                    } else {
                        schemaNode.description = v;
                    }
                }
            }, [mapKey]);
            const typedJSON = {};
            const parent = { [mapKey]: typedJSON };
            generateTypedJSON(translatedSchema, mapKey, parent);
            const prettierJSONString = prettier.format(CommentJSON.stringify(typedJSON, null, 2), {
                parser: 'json5',
                semi: false,
                quoteProps: 'preserve'
            });
            const output = [];
            if (schema.description) {
                output.push(schema.description);
            }
            output.push('```json');
            output.push(prettierJSONString);
            output.push('```');
            translatedMap[mapKey] = output.join('\n');
        } else {
            translatedMap[mapKey] = translatedFlatMap[mapKey] || schema;
        }
    });
    return translatedMap;
}

module.exports = {
    fetchDocumentationIds,
    doSchemaTranslation
};
