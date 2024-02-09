/* eslint-disable consistent-return */
import { parse as parseHtml, TextNode, HTMLElement } from 'node-html-parser';
import * as CommentJSON from '@projectxero/comment-json';
import * as prettier from 'prettier';
import { cachedOutput, forEachObject, deepCopy, testMinecraftVersionInRange, warn, log } from '../util/common.js';
import { CommentLocation, addJSONComment } from '../util/comment.js';
import { octokit, fetchGitBlob } from '../util/network.js';

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

/**
 * @typedef {{ name: string; id: string; level: number; sections?: any[] }} Section
 * @param {Array<{ name: string; href: string; level: number }>} index
 * @param {Array<Section>} sections
 */
function treeifyDocument(index, sections) {
    if (sections.length === 0) return [];
    const hrefMap = sections.reduce((/** @type {Record<string, number[]>} */map, e, i) => {
        const k = `#${e.id}`;
        if (!map[k]) map[k] = [];
        map[k].push(i);
        return map;
    }, {});
    const maxIndexLevel = index.reduce((max, e) => Math.max(e.level, max), 0);
    const indexSectionMap = index.map((e) => hrefMap[e.href]);
    /** @type {(startVec: Array<number | null>, startSectionPos: number) => Array<{ score: number, indexSections: Array<Section | undefined> }>} */
    const listAllSolutions = (startVec, startSectionPos) => {
        if (startVec.length >= indexSectionMap.length) {
            /** @type {Array<Section | undefined>} */
            const indexSections = startVec.map((e) => sections[e]);
            const grouped = indexSections.reduce((/** @type {Record<string, number[]>} */map, e, i) => {
                const k = index[i].level;
                if (!map[k]) map[k] = [];
                map[k].push(Math.abs(e.level - k));
                return map;
            }, {});
            const stdev = Object.entries(grouped).map(([, v]) => {
                const avg = v.reduce((s, e) => s + e, 0) / v.length;
                const dev = v.reduce((s, e) => s + (e - avg) ** 2, 0);
                return Math.sqrt(dev);
            });
            const score = stdev.reduce((s, e) => s + e, 0);
            return [{ score, indexSections }];
        }
        const choices = indexSectionMap[startVec.length];
        if (choices) {
            return choices.flatMap((e) => {
                if (e < startSectionPos) return [];
                return listAllSolutions([...startVec, e], e + 1);
            });
        }
        return listAllSolutions([...startVec, null], startSectionPos);
    };
    const solutions = listAllSolutions([], 0);
    solutions.sort((a, b) => a.score - b.score);
    const best = solutions.length ? solutions[0].indexSections : [];
    sections.forEach((e) => {
        const contentLevel = e.level;
        const indexPos = best.indexOf(e);
        const indexLevel = indexPos >= 0 ? index[indexPos].level : NaN;
        e.level = Number.isNaN(indexLevel) ? contentLevel + maxIndexLevel + 1 : indexLevel;
    });
    const root = { sections: [], level: 0 };
    /** @type {Section[]} */
    const sectionStack = [root];
    sections.forEach((e) => {
        while (sectionStack.length) {
            if (sectionStack[0].level >= e.level) {
                sectionStack.shift();
            } else {
                break;
            }
        }
        if (!sectionStack[0].sections) {
            sectionStack[0].sections = [];
        }
        sectionStack[0].sections.push(e);
        sectionStack.unshift(e);
    });
    return root.sections;
}

BedrockDocStates.set('end', () => undefined);
BedrockDocStates.set('initial', (el, { document }) => {
    if (el instanceof HTMLElement && el.tagName === 'H1') {
        const match = /(.+?)\s*Version:\s*([\d.]+)/.exec(el.innerText.trim());
        [, document.title, document.version] = match;
        return 'index.title';
    }
});
BedrockDocStates.set('index.title', (el) => {
    if (el instanceof HTMLElement && el.tagName === 'H2' && el.innerText.trim() === 'Index') {
        return 'index.table';
    }
});
BedrockDocStates.set('index.table', (el, { document, index, state }) => {
    if (el instanceof HTMLElement && el.tagName === 'TABLE') {
        const tableRows = el.querySelectorAll('tr > :is(th,td) > a');
        document.content = [];
        const indexSections = tableRows.map((a) => ({
            name: a.text.trim(),
            href: a.getAttribute('href'),
            level: a.parentNode.tagName === 'TH' ? 1 : 2
        })).filter((e) => e.name.length > 0);
        index.push(...indexSections);
        state.currentSection = document;
        return 'section';
    }
});
BedrockDocStates.set('section', (el, { sections, state }) => {
    let content;
    if (el instanceof HTMLElement) {
        const level = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].indexOf(el.tagName);
        if (level >= 0) {
            const p = el.querySelector('p');
            const newSection = {
                name: elText(el),
                id: p && p.id ? p.id : undefined,
                level,
                content: []
            };
            if (newSection.name.trim().length === 0) {
                return;
            }
            sections.push(newSection);
            state.currentSection = newSection;
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
        } else if (el.tagName === 'TEXTAREA' || el.tagName === 'PRE') {
            content = {
                type: 'code',
                content: elText(el).split('\n')
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
            warn(`Unexpected tag: ${el.tagName}`);
            content = {
                type: el.tagName.toLowerCase(),
                content: elText(el)
            };
        }
    } else {
        content = elText(el);
    }
    if (content) {
        state.currentSection.content.push(content);
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
                            content: []
                        };
                        const sections = [];
                        processDocStateMachine(columnNodes[i].childNodes, 'section', {
                            index: [],
                            sections,
                            state: {
                                currentSection: cellRoot
                            }
                        });
                        cellRoot.sections = treeifyDocument([], sections);
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
    'TEXTAREA', 'OL', 'LI', 'PRE'
];
/** @param {string} htmlContent */
function cleanHtml(htmlContent) {
    return htmlContent.replace(/<a\b(?:.*?)>Back to top<\/a>/ig, '')
        .replace(/```([^]*?)```/g, '<pre>$1</pre>')
        .replace(/<(textarea|pre)\b(?:.*?)>([^]*?)<\/\1>/ig, (match, tag, content) => {
            const escapedContent = content.replace(/<(?:\/)?br\s*(?:\/)?\s*>/g, '\n')
                .replace(/<(?:\/)?pre>/g, '```')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            return `<${tag}>${escapedContent}</${tag}>`;
        })
        .replace(/<([\w]+)\b(?:(?:".+?"|.)*?)>/g, (match, tagName) => {
            if (NormalTagNames.includes(tagName.toUpperCase())) {
                return match;
            }
            return `&lt;${tagName}&gt;`;
        });
}

function parseBedrockDoc(content) {
    const root = parseHtml(cleanHtml(content));
    const document = {};
    const index = [];
    const sections = [];
    const state = {};
    processDocStateMachine(root.childNodes, 'initial', { document, index, sections, state });
    document.sections = treeifyDocument(index, sections);
    return document;
}

function findSection(node, ...path) {
    let cursor = [node];
    const sectionPath = path.slice();
    while (sectionPath.length) {
        const children = cursor.flatMap((e) => e.sections || []);
        const sectionName = sectionPath.shift();
        cursor = children.filter((e) => {
            if (sectionName instanceof RegExp) {
                return sectionName.test(e.name);
            }
            return e.name === sectionName;
        });
        if (!cursor.length) {
            throw new Error(`Section not found: ${path.join('/')}`);
        }
    }
    return cursor[0];
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
            warn('Unexpected table');
        }
    }
    return schema;
}

function createSectionSummaryAnalyzer({ path, withSchema, ...args }) {
    return {
        ...args,
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
    path,
    tableIndex,
    idKey,
    getId,
    descriptionKey,
    getDescription,
    withSchema,
    errorWhenNoTable,
    ...args
}) {
    return {
        ...args,
        extract(doc) {
            const section = findSection(doc, ...path);
            const tables = section.content.filter((e) => typeof e === 'object' && e.type === 'table');
            const table = tables[tableIndex >= 0 ? tableIndex : tables.length + tableIndex];
            if (!table) {
                if (errorWhenNoTable) {
                    throw new Error(`Cannot find table in section ${path.join('/')}`);
                }
                return {};
            }
            const result = {};
            const idGetter = (row) => {
                if (getId) {
                    return getId(row);
                }
                if (idKey) {
                    return row[idKey];
                }
                throw new Error('Id cannot be empty');
            };
            const descriptionGetter = (row) => {
                if (getDescription) {
                    return getDescription(row);
                }
                if (descriptionKey) {
                    return row[descriptionKey];
                }
                return '';
            };
            table.rows.forEach((row) => {
                const parsedId = contentToPlain(idGetter(row));
                const parsedDesc = descriptionGetter(row);
                if (withSchema) {
                    result[parsedId] = generateSchema(parsedDesc);
                } else {
                    result[parsedId] = contentFirstLine(parsedDesc);
                }
            });
            return result;
        }
    };
}

function createSchemeTableAnalyzer({
    name,
    target,
    path,
    tableIndex,
    ...args
}) {
    return {
        ...args,
        name: target,
        extract(doc) {
            const section = findSection(doc, ...path);
            const tables = section.content.filter((e) => typeof e === 'object' && e.type === 'table');
            const table = tables[tableIndex >= 0 ? tableIndex : tables.length + tableIndex];
            if (!table) {
                throw new Error(`Cannot find table in section ${path.join('/')}`);
            }
            const result = {};
            result[name] = generateSchema([table]);
            return result;
        }
    };
}

const pageAnalyzer = [
    // before 1.20
    createSectionTableAnalyzer({
        name: 'blockState',
        documentation: 'Addons',
        precondition: ({ version }) => testMinecraftVersionInRange(version, '', '1.19.80.24'),
        path: ['BlockStates'],
        tableIndex: 0,
        idKey: 'Block State Name',
        descriptionKey: 'Description'
    }),
    createSectionTableAnalyzer({
        name: 'block',
        documentation: 'Addons',
        precondition: ({ version }) => testMinecraftVersionInRange(version, '', '1.19.80.24'),
        path: ['Blocks'],
        tableIndex: 0,
        idKey: 'Name'
    }),

    // since 1.20
    createSectionTableAnalyzer({
        name: 'blockState',
        documentation: 'Addons',
        precondition: ({ version }) => testMinecraftVersionInRange(version, '1.20.0.20', '*'),
        path: ['Blocks', 'BlockStates', 'List of all BlockStates'],
        tableIndex: 0,
        idKey: 'BlockState Name',
        descriptionKey: 'Description'
    }),
    createSectionTableAnalyzer({
        name: 'block',
        documentation: 'Addons',
        precondition: ({ version }) => testMinecraftVersionInRange(version, '1.20.0.20', '*'),
        path: ['Blocks', 'Blocks', 'List of fully-qualified block names'],
        tableIndex: 0,
        idKey: 'Name'
    }),

    createSectionTableAnalyzer({
        name: 'entity',
        documentation: 'Addons',
        path: ['Entities'],
        tableIndex: 0,
        idKey: 'Identifier',
        getDescription(row) {
            const { 'Full ID': fullId, 'Short ID': shortId } = row;
            return `0x${fullId.toString(16).padStart(8, '0')} (0x${shortId.toString(16).padStart(2, '0')})`;
        }
    }),
    createSectionTableAnalyzer({
        name: 'damageSource',
        documentation: 'Addons',
        path: ['Entity Damage Source'],
        tableIndex: 0,
        idKey: 'Damage Source',
        descriptionKey: 'ID'
    }),
    // createMojangSchemeAnalyzer({
    //     name: 'biome_schema',
    //     target: 'schema',
    //     documentation: 'Biomes',
    //     path: ['Schema'],
    //     codeIndex: 0
    // }),
    createSchemeTableAnalyzer({
        name: 'block_components',
        target: 'schema',
        documentation: 'Blocks',
        path: ['Blocks', 'Block Components'],
        tableIndex: 0
    }),
    createSchemeTableAnalyzer({
        name: 'block_event_responses',
        target: 'schema',
        documentation: 'Blocks',
        path: ['Blocks', 'Block Event Responses'],
        tableIndex: 0
    }),
    createSchemeTableAnalyzer({
        name: 'block_trigger_components',
        target: 'schema',
        documentation: 'Blocks',
        path: ['Blocks', 'Block Trigger Components'],
        tableIndex: 0
    }),
    createSectionTableAnalyzer({
        name: 'entitySpawnRuleConditionComponent',
        documentation: 'Entities',
        path: ['Data-Driven Spawning', 'Spawn Rules', 'Conditions', 'Components'],
        tableIndex: 0,
        idKey: 'Name',
        descriptionKey: 'Description'
    }),
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
        name: 'itemComponent',
        documentation: 'Item',
        path: ['Items', /components v[\d.]+/],
        tableIndex: 0,
        idKey: 'Name',
        descriptionKey: 'Description'
    }),
    createSectionTableAnalyzer({
        name: 'molangMath',
        documentation: 'Molang',
        path: ['Lexical Structure', 'Math Functions'],
        tableIndex: 0,
        getId(row) {
            return row.Function.replace(/^`(.+)`$/, '$1');
        },
        descriptionKey: 'Description'
    }),
    createSectionTableAnalyzer({
        name: 'molangQuery',
        documentation: 'Molang',
        path: ['Query Functions', 'List of Entity Queries'],
        tableIndex: 0,
        idKey: 'Name',
        descriptionKey: 'Description'
    }),
    createSectionTableAnalyzer({
        name: 'molangQueryExperimental',
        documentation: 'Molang',
        path: ['Query Functions', 'List of Experimental Entity Queries'],
        tableIndex: 0,
        idKey: 'Name',
        descriptionKey: 'Description'
    }),
    // createMojangSchemeAnalyzer({
    //     target: 'schema',
    //     documentation: 'Schemas',
    //     path: ['Schemas'],
    //     codeIndex: 0
    // }),
    createSchemeTableAnalyzer({
        name: 'volume_components',
        target: 'schema',
        documentation: 'Volumes',
        path: ['Volumes', 'Volume Components'],
        tableIndex: 0
    })
];

const remapIdTable = [
    ['entityFilter', 'entityFilter'],
    ['entityBehavior', 'entityBehavior'],
    ['entityAttribute', 'entityAttribute'],
    ['entityBuiltinEvent', 'entityBuiltinEvent'],
    ['entityComponent', 'entityComponent'],
    ['entityProperty', 'entityProperty'],
    ['entityTrigger', 'entityTrigger'],
    ['featureType', 'featureType'],
    ['molangQuery', 'molangQuery'],
    ['molangQueryExperimental', 'molangQuery']
];

function extractDocumentationIds(docMap) {
    const target = {};
    const indexMap = {};
    forEachObject(docMap, (v, k) => {
        if (typeof v !== 'object') return;
        const visitor = (doc) => ({
            name: doc.name || doc.title,
            sections: doc.sections?.map(visitor)
        });
        indexMap[k] = visitor(v);
    });
    target.index = indexMap;
    pageAnalyzer.forEach((analyzer) => {
        const doc = docMap[analyzer.documentation];
        if (!doc) {
            throw new Error(`Documentation not found: ${analyzer.documentation}`);
        }
        if (analyzer.precondition) {
            if (!analyzer.precondition(doc)) {
                return;
            }
        }
        try {
            const extractResult = analyzer.extract(doc);
            if (analyzer.name in target) {
                Object.assign(target[analyzer.name], extractResult);
            } else {
                target[analyzer.name] = extractResult;
            }
        } catch (err) {
            warn(`Failed to extract ${analyzer.name}`, err);
            throw err;
        }
    });
    return target;
}

const repoConfig = {
    owner: 'Mojang',
    repo: 'bedrock-samples'
};

const branchMap = {
    release: 'main',
    beta: 'preview'
};

const versionRegExp = /"latest"[\s\n\r]*:[\s\n\r]*{[^"]*?"version"[\s\n\r]*:[\s\n\r]*"([\w.]+)"/;

async function fetchBehaviorPack(treeSHA, cacheKey) {
    const tree = (await octokit.git.getTree({ ...repoConfig, tree_sha: treeSHA, recursive: 1 })).data;
    const versionNode = tree.tree.find((e) => e.path === 'version.json');
    log('Fetching version for documentation...');
    const versionJSON = await fetchGitBlob(versionNode, 'utf-8');
    const versionJSONMatch = versionJSON.match(versionRegExp);
    const map = { __VERSION__: versionJSONMatch && versionJSONMatch[1] };
    for (const blob of tree.tree) {
        const fnMatch = /documentation\/(.+)\.html/i.exec(blob.path);
        if (fnMatch && fnMatch[1].toLowerCase() !== 'index') {
            const blobCacheKey = `${cacheKey}.${fnMatch[1].toLowerCase().replace(/\s/g, '_')}`;
            let cache = cachedOutput(blobCacheKey);
            if (!cache || cache.__OBJECTHASH__ !== blob.sha) {
                cache = parseBedrockDoc(await fetchGitBlob(blob, 'utf-8'));
                cache.__OBJECTHASH__ = blob.sha;
                cachedOutput(blobCacheKey, cache);
            }
            map[fnMatch[1]] = cache;
        }
    }
    return map;
}

export async function fetchDocumentationIds(cx) {
    const { version } = cx;
    const cacheKey = `version.common.documentation.${version}`;
    let cache = cachedOutput(cacheKey);
    try {
        const repoBranch = (await octokit.repos.getBranch({ ...repoConfig, branch: branchMap[version] })).data;
        const commitHash = repoBranch.commit.sha;
        if (!cache || cache.__COMMITHASH__ !== commitHash) {
            const behaviorPackParsed = await fetchBehaviorPack(repoBranch.commit.commit.tree.sha, cacheKey);
            cache = cachedOutput(cacheKey, {
                __VERSION__: behaviorPackParsed.__VERSION__,
                __COMMITHASH__: commitHash,
                ...extractDocumentationIds(behaviorPackParsed)
            });
        }
    } catch (err) {
        if (!cache) {
            throw err;
        }
        warn('Failed to fetch template behavior pack, use cache instead', err);
    }
    const target = {};
    remapIdTable.forEach(([name, targetName]) => {
        if (targetName in target) {
            Object.assign(target[targetName], cache[name]);
        } else {
            target[targetName] = cache[name];
        }
    });
    return target;
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
    let result;
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
        case 'List':
            result = [];
            if (schema.defaultValue) {
                addJSONComment(result, CommentLocation.before(), 'inlineBlock', schema.defaultValue);
            }
            return result;
        case 'JSON Object':
            result = {};
            if (schema.defaultValue) {
                addJSONComment(result, CommentLocation.before(), 'inlineBlock', schema.defaultValue);
            }
            return result;
        case 'Range [a, b]':
            return tryParseJSON(schema.defaultValue, 0);
        case 'Vector [a, b]':
            return tryParseJSON(schema.defaultValue, [0, 0]);
        case 'Vector [a, b, c]':
            return tryParseJSON(schema.defaultValue, [0, 0, 0]);
        case 'Minecraft Filter':
        case 'Trigger':
        case 'Item Description Properties':
            if (schema.defaultValue) {
                result = {};
                addJSONComment(result, CommentLocation.before(), 'inlineBlock', schema.defaultValue);
                return result;
            }
            return null;
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
            warn(`Unexpected non-object type: ${name}`);
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

export function doSchemaTranslation(schemaMap, onTranslate) {
    const flatMap = {};
    forEachObject(schemaMap, (schema, mapKey) => {
        visitSchema(schema, (type, schemaNode, path) => {
            const k = path.join('|>');
            if (k in flatMap) {
                warn(`Duplicated path: ${k}`);
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
