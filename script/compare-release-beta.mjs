// 比较工作区 version/release 与某个 git 提交中 version/beta 的异同（文件级文本 diff）。
//
// 用法:
//   node script/compare-release-beta.mjs [revision] [--out <html路径>] [--folders-only]
//
//   revision         git 提交/分支/tag，缺省为 HEAD（可用短哈希，如 3d6859e5）
//   --out <path>     报告写入路径，缺省写到系统临时目录并打印完整路径
//   --folders-only   只比较 autocompletion/{vanilla,education,experiment}/ 子目录
//                    及 gametest/，跳过 autocompletion 顶层 vanilla.json /
//                    education.json / experiment.json 三个汇总文件
//   --help           显示本帮助
//
// 比较范围: version/beta/<相对路径> @revision  ↔  工作区 version/release/<相对路径>
// 仅比较 autocompletion/** 与 gametest/**（package/** 等不在范围内）。
//
// 说明:
//   - 只做文本/文件级比较，不解析 JSON，格式变化不影响本脚本。
//   - diff 方向与 VS Code Git UI 一致: 左侧(-)为参考版本 beta@revision，
//     右侧(+)为工作区 release。即 “-”= beta 有而 release 没有(疑似缺失)，
//     “+”= release 新增或改动的行。
//   - “仅版本号行差异” 是一个纯文本启发标记: 若某文件全部差异行都只包含
//     "packageVersion" 字样(通常两侧仅版本号不同)，标为近似一致，便于筛出
//     真正需要人工核对的文件。它只是展示提示，不影响任何判定。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const RELEASE_DIR = join(REPO_ROOT, 'version', 'release'); // 本地工作区（右侧）
const BETA_RELPATH_PREFIX = 'version/beta/'; // git 中的参考版本（左侧）

const MAX_PATCH_CHARS = 4 * 1024 * 1024; // 单个文件 patch 嵌入 HTML 的上限（防御性）

// 管道下游提前关闭（如 `... | Select-Object -First n`）时静默退出，不报 EPIPE 崩溃。
for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err) => {
        if (err.code === 'EPIPE') process.exit(0);
        throw err;
    });
}

// ---------- 工具 ----------

function git(args, opts = {}) {
    return execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        ...opts
    });
}

/** 用相对 '/' 路径遍历目录下所有文件（不含目录），结果排序。 */
function walkFiles(root, relDir = '') {
    const result = [];
    const dir = relDir ? join(root, ...relDir.split('/')) : root;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) result.push(...walkFiles(root, rel));
        else if (entry.isFile()) result.push(rel);
    }
    return result;
}

/** 计算本地文件的 git blob sha1（等价 `git hash-object <file>`）。 */
function blobShaOfLocalFile(absPath) {
    const buf = readFileSync(absPath);
    const h = createHash('sha1');
    h.update(`blob ${buf.length}\0`);
    h.update(buf);
    return h.digest('hex');
}

/** 文本行尾统一为 \n；返回字符串。 */
function normalizeEol(text) {
    return text.replace(/\r\n?/g, '\n');
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 命令行解析 ----------

function printHelp() {
    process.stdout.write(`比较工作区 version/release 与某 git 版本 version/beta 的异同（文件级）。

用法:
  node script/compare-release-beta.mjs [revision] [选项]

参数:
  revision       git 提交/分支/tag（如 3d6859e5），缺省为 HEAD

选项:
  --out <path>   报告 HTML 输出路径；缺省写入系统临时目录
  --folders-only 只比较 autocompletion/{vanilla,education,experiment}/ 子目录
                 与 gametest/，跳过 autocompletion 顶层三个汇总 json
  --help         显示本帮助

比较范围: version/beta/<rel> @revision  ↔  工作区 version/release/<rel>
仅覆盖 autocompletion/** 与 gametest/**。差异方向: “-”=beta 有而 release 没有,
“+”=release 新增或改动（与 VS Code Git 对比一致）。
`);
}

function parseArgs(argv) {
    const args = { revision: 'HEAD', out: null, foldersOnly: false, help: false };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--out') args.out = argv[++i];
        else if (a === '--folders-only') args.foldersOnly = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (a.startsWith('-')) {
            throw new Error(`未知选项: ${a}（用 --help 查看用法）`);
        } else rest.push(a);
    }
    if (rest.length > 1) throw new Error(`多余的位置参数: ${rest.slice(1).join(' ')}（用 --help 查看用法）`);
    if (rest.length === 1) args.revision = rest[0];
    return args;
}

const SCOPE_PREFIXES = ['autocompletion/', 'gametest/'];
const FOLDER_ONLY_AGGREGATES = [
    'autocompletion/vanilla.json',
    'autocompletion/education.json',
    'autocompletion/experiment.json'
];

function inScope(rel) {
    if (!SCOPE_PREFIXES.some((p) => rel.startsWith(p))) return false;
    return true;
}

// ---------- 主流程 ----------

function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (e) {
        process.stderr.write(`${e.message}\n`);
        process.exitCode = 2;
        return;
    }
    if (args.help) {
        printHelp();
        return;
    }

    // 1. 解析 revision
    let rev, revShort, revSubject;
    try {
        rev = git(['rev-parse', '--verify', '--quiet', `${args.revision}^{commit}`]).trim();
    } catch {
        process.stderr.write(`无法解析 revision "${args.revision}" 为 git 提交。\n`);
        process.exitCode = 2;
        return;
    }
    revShort = git(['rev-parse', '--short', rev]).trim();
    try {
        revSubject = git(['log', '-1', '--format=%s', rev]).trim();
    } catch {
        revSubject = '';
    }

    // 2. 枚举 B 侧（git 中 beta 的文件名 + blob sha）
    const betaFiles = new Map(); // rel -> sha
    const lsTreeRaw = git(['ls-tree', '-r', '-z', rev, '--', 'version/beta']);
    for (const line of lsTreeRaw.split('\0')) {
        if (!line) continue;
        const m = /^(\S+) blob (\S+)\t(.+)$/.exec(line);
        if (!m) continue;
        const full = m[3];
        if (!full.startsWith(BETA_RELPATH_PREFIX)) continue;
        const rel = full.slice(BETA_RELPATH_PREFIX.length);
        if (!inScope(rel)) continue;
        if (args.foldersOnly && FOLDER_ONLY_AGGREGATES.includes(rel)) continue;
        betaFiles.set(rel, m[2]);
    }

    // 3. 枚举 A 侧（工作区 release）
    const releaseFiles = walkFiles(RELEASE_DIR)
        .filter((rel) => {
            if (!inScope(rel)) return false;
            if (args.foldersOnly && FOLDER_ONLY_AGGREGATES.includes(rel)) return false;
            return true;
        })
        .sort();

    // 4. 分类
    const groups = {
        same: [], // 完全一致
        modified: [], // 有内容差异
        onlyBeta: [], // beta 有而 release 没有
        onlyRelease: [] // release 有而 beta 没有
    };

    const relSet = new Set(releaseFiles);
    for (const rel of betaFiles.keys()) {
        if (!relSet.has(rel)) {
            groups.onlyBeta.push(rel);
        }
    }
    for (const rel of releaseFiles) {
        if (!betaFiles.has(rel)) {
            groups.onlyRelease.push(rel);
        }
    }
    for (const rel of releaseFiles) {
        if (!betaFiles.has(rel)) continue;
        const betaSha = betaFiles.get(rel);
        const localPath = join(RELEASE_DIR, ...rel.split('/'));
        const localSha = blobShaOfLocalFile(localPath);
        if (localSha === betaSha) {
            groups.same.push(rel);
            continue;
        }
        // 读两侧文本做归一化比较与 diff
        const betaText = git(['cat-file', 'blob', betaSha]);
        const releaseText = readFileSync(localPath, 'utf8');
        const nb = normalizeEol(betaText);
        const nr = normalizeEol(releaseText);
        if (nb === nr) {
            groups.same.push(rel); // 仅行尾差异，视为一致
            continue;
        }
        groups.modified.push(rel);
    }

    // 5. 为 modified 生成 patch（beta 为旧侧 '-'，release 为新侧 '+'）
    const tmpDir = mkdtempSync(join(tmpdir(), 'crb-'));
    const patches = new Map();
    try {
        for (const rel of groups.modified) {
            const betaText = normalizeEol(git(['cat-file', 'blob', betaFiles.get(rel)]));
            const releaseText = normalizeEol(readFileSync(join(RELEASE_DIR, ...rel.split('/')), 'utf8'));
            const tmpBeta = join(tmpDir, 'beta.tmp');
            const tmpRelease = join(tmpDir, 'release.tmp');
            writeFileSync(tmpBeta, betaText.endsWith('\n') ? betaText : `${betaText}\n`);
            writeFileSync(tmpRelease, releaseText.endsWith('\n') ? releaseText : `${releaseText}\n`);
            let patch;
            try {
                patch = git(['diff', '--no-index', '--no-color', '-U3', '--', tmpBeta, tmpRelease]);
            } catch (e) {
                // git diff --no-index 在存在差异时以退出码 1 结束，属正常
                patch = String(e.stdout ?? '');
            }
            // 改写头部，使展示路径可读
            patch = patch
                .split('\n')
                .map((line) => {
                    if (line.startsWith('--- ')) return `--- beta@${revShort}  version/beta/${rel}`;
                    if (line.startsWith('+++ ')) return `+++ release@working directory  version/release/${rel}`;
                    if (line.startsWith('diff --git ') || line.startsWith('index ')) return null;
                    return line;
                })
                .filter((l) => l !== null)
                .join('\n')
                .replace(/\n+$/, '');
            patches.set(rel, patch);
        }
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }

    // 6. 统计每个 modified 文件的增删行数与“实质差异”标记
    const detail = new Map();
    for (const rel of groups.modified) {
        const patch = patches.get(rel);
        const lines = patch.split('\n');
        let added = 0;
        let removed = 0;
        const realChanges = []; // 不含 packageVersion 行的差异行
        for (const line of lines) {
            if (line.startsWith('@@')) continue;
            if (line.startsWith('+++') || line.startsWith('---')) continue;
            if (line.startsWith('+')) {
                added++;
                if (!line.includes('"packageVersion"')) realChanges.push(line);
            } else if (line.startsWith('-')) {
                removed++;
                if (!line.includes('"packageVersion"')) realChanges.push(line);
            }
        }
        const onlyVersionLineDiff = realChanges.length === 0;
        detail.set(rel, { added, removed, onlyVersionLineDiff, patch });
    }

    // 7. 控制台摘要
    const sorted = (arr) => [...arr].sort();
    process.stdout.write('='.repeat(72) + '\n');
    process.stdout.write(`release(本地工作区) vs beta@${revShort} (${revSubject})\n`);
    process.stdout.write(`范围: autocompletion/** + gametest/**${args.foldersOnly ? '（跳过顶层汇总 json）' : ''}\n`);
    process.stdout.write('='.repeat(72) + '\n');
    process.stdout.write(
        `相同: ${groups.same.length}   修改: ${groups.modified.length}   ` +
            `仅 beta: ${groups.onlyBeta.length}   仅 release: ${groups.onlyRelease.length}\n`
    );
    const realFiles = [...detail.entries()].filter(([, d]) => !d.onlyVersionLineDiff).map(([rel]) => rel);
    process.stdout.write('\n[实质内容差异，需人工核对]\n');
    if (realFiles.length === 0) process.stdout.write('(无)\n');
    for (const rel of realFiles) {
        const d = detail.get(rel);
        process.stdout.write(`  ${rel}  (-${d.removed} +${d.added})\n`);
    }
    if (groups.onlyBeta.length) {
        process.stdout.write('\n[仅 beta 存在（release 缺失，结构层差异）]\n');
        for (const rel of sorted(groups.onlyBeta)) process.stdout.write(`  ${rel}\n`);
    }
    if (groups.onlyRelease.length) {
        process.stdout.write('\n[仅 release 存在]\n');
        for (const rel of sorted(groups.onlyRelease)) process.stdout.write(`  ${rel}\n`);
    }

    // 8. 生成 HTML 报告
    const html = buildHtml({
        args,
        rev,
        revShort,
        revSubject,
        groups,
        detail,
        releaseCount: releaseFiles.length,
        betaCount: betaFiles.size
    });
    const outPath = args.out
        ? resolve(process.cwd(), args.out)
        : join(tmpdir(), `compare-release-beta-${revShort}.html`);
    writeFileSync(outPath, html, 'utf8');
    process.stdout.write(`\nHTML 报告: ${outPath}\n`);
}

// ---------- HTML ----------

function buildHtml({ args, revShort, revSubject, groups, detail, releaseCount, betaCount }) {
    const when = new Date().toLocaleString('zh-CN');
    const chips = (label, n, cls) =>
        `<div class="chip ${cls}"><div class="chip-n">${n}</div><div class="chip-l">${label}</div></div>`;

    const legend = `
        <div class="legend">
            <span><span class="sw del"></span>- release 缺失</span>
            <span><span class="sw add"></span>+ release 新增或改动</span>
            <span><span class="sw hunk"></span>@@ hunk 行号</span>
        </div>`;

    // 修改的文件，实质差异在前
    const modifiedRows = [...groups.modified].sort((a, b) => {
        const da = detail.get(a);
        const db = detail.get(b);
        return Number(da.onlyVersionLineDiff) - Number(db.onlyVersionLineDiff);
    });

    const rowHtml = (rel, badge, metaHtml) => {
        const d = detail.get(rel);
        const stats = d ? `<span class="stat">-${d.removed} +${d.added}</span>` : '';
        return `<details class="row"><summary><span class="fname">${escapeHtml(rel)}</span>${stats} ${badge}${metaHtml ?? ''}</summary>
            ${d ? `<pre class="diff">${renderPatch(d.patch)}</pre>` : '<div class="none">（无内容，仅结构差异）</div>'}
        </details>`;
    };

    const realBadge = `<span class="badge real">实质差异</span>`;
    const versionBadge = `<span class="badge ver">仅版本号行差异</span>`;

    const sameHtml = groups.same.map((rel) => `<li>${escapeHtml(rel)}</li>`).join('\n');
    const onlyBetaHtml = groups.onlyBeta
        .map((rel) => rowHtml(rel, `<span class="badge only-beta">仅 beta</span>`, ''))
        .join('\n');
    const onlyReleaseHtml = groups.onlyRelease
        .map((rel) => rowHtml(rel, `<span class="badge only-rel">仅 release</span>`, ''))
        .join('\n');

    const scopeNote = `autocompletion/** + gametest/**${args.foldersOnly ? '（已跳过 autocompletion 顶层汇总 json）' : ''}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>release vs beta@${escapeHtml(revShort)}</title>
<style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: #fff; color: #1f2328; }
    @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } }
    header { padding: 16px 24px; border-bottom: 1px solid #d0d7de; }
    @media (prefers-color-scheme: dark) { header { border-color: #30363d; } }
    h1 { font-size: 18px; margin: 0 0 6px; }
    .sub { font-size: 13px; color: #57606a; }
    @media (prefers-color-scheme: dark) { .sub { color: #8b949e; } }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; padding: 14px 24px 4px; }
    .chip { border: 1px solid #d0d7de; border-radius: 8px; padding: 8px 14px; min-width: 84px; text-align: center; }
    @media (prefers-color-scheme: dark) { .chip { border-color: #30363d; } }
    .chip-n { font-size: 22px; font-weight: 600; }
    .chip-l { font-size: 12px; color: #57606a; }
    @media (prefers-color-scheme: dark) { .chip-l { color: #8b949e; } }
    .chip.same .chip-n { color: #1a7f37; }
    .chip.mod .chip-n { color: #d4a72c; }
    .chip.only .chip-n { color: #cf222e; }
    @media (prefers-color-scheme: dark) { .chip.same .chip-n { color: #3fb950; } .chip.mod .chip-n { color: #d29922; } .chip.only .chip-n { color: #f85149; } }
    .legend { padding: 10px 24px; font-size: 12px; color: #57606a; display: flex; gap: 18px; flex-wrap: wrap; }
    @media (prefers-color-scheme: dark) { .legend { color: #8b949e; } }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
    .sw.del { background: #ff818266; }
    .sw.add { background: #56d36466; }
    .sw.hunk { background: #a5d6ff66; }
    main { padding: 8px 24px 40px; max-width: 1200px; }
    h2 { font-size: 15px; margin: 22px 0 8px; }
    .group { border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 6px; overflow: hidden; }
    @media (prefers-color-scheme: dark) { .group { border-color: #30363d; } }
    details.row > summary { cursor: pointer; padding: 7px 12px; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; display: flex; align-items: center; gap: 10px; }
    details.row > summary:hover { background: #f6f8fa; }
    @media (prefers-color-scheme: dark) { details.row > summary:hover { background: #161b22; } }
    details.row[open] > summary { border-bottom: 1px solid #d0d7de; }
    @media (prefers-color-scheme: dark) { details.row[open] > summary { border-color: #30363d; } }
    .fname { flex: 1; word-break: break-all; }
    .stat { color: #57606a; font-size: 11.5px; }
    @media (prefers-color-scheme: dark) { .stat { color: #8b949e; } }
    .badge { font-size: 11px; padding: 1px 7px; border-radius: 10px; white-space: nowrap; }
    .badge.real { background: #fff1e5; color: #bc4c00; }
    .badge.ver { background: #eaeef2; color: #57606a; }
    .badge.only-beta { background: #ffebe9; color: #cf222e; }
    .badge.only-rel { background: #dafbe1; color: #1a7f37; }
    @media (prefers-color-scheme: dark) {
        .badge.real { background: #3d2d00; color: #f0883e; }
        .badge.ver { background: #21262d; color: #8b949e; }
        .badge.only-beta { background: #da3633; color: #ffebe9; }
        .badge.only-rel { background: #238636; color: #dafbe1; }
    }
    pre.diff { margin: 0; padding: 10px 14px; overflow-x: auto; font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 12px; line-height: 1.45; }
    .none { padding: 8px 14px; font-size: 12.5px; color: #57606a; }
    ul.same-list { margin: 0; padding: 10px 14px 10px 34px; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; columns: 2; }
    @media (max-width: 800px) { ul.same-list { columns: 1; } }
    .dl { color: #1f2328; }
    @media (prefers-color-scheme: dark) { .dl { color: #e6edf3; } }
    .dh { color: #57606a; }
    @media (prefers-color-scheme: dark) { .dh { color: #8b949e; } }
    .da { background: #e6ffec; color: #1a7f37; }
    .dd { background: #ffebe9; color: #cf222e; }
    @media (prefers-color-scheme: dark) { .da { background: #12261d; color: #3fb950; } .dd { background: #3d1a1e; color: #ff7b72; } }
</style>
</head>
<body>
<header>
    <h1>version/release（本地工作区） vs version/beta@${escapeHtml(revShort)}</h1>
    <div class="sub">参考提交: ${escapeHtml(revShort)} ${escapeHtml(revSubject || '')} · 生成时间: ${escapeHtml(when)} · 范围: ${escapeHtml(scopeNote)}（本地 ${releaseCount} 个文件, 参考 ${betaCount} 个文件）</div>
</header>
<div class="chips">
    ${chips('实质差异', groups.modified.filter((r) => !detail.get(r).onlyVersionLineDiff).length, 'mod')}
    ${chips('仅版本号行差异', groups.modified.filter((r) => detail.get(r).onlyVersionLineDiff).length, 'mod')}
    ${chips('相同', groups.same.length, 'same')}
    ${chips('仅 beta', groups.onlyBeta.length, 'only')}
    ${chips('仅 release', groups.onlyRelease.length, 'only')}
</div>
<div class="legend">${legend}</div>
<main>
    <h2>有实质内容差异（需人工核对）</h2>
    <div class="group">${
        modifiedRows
            .filter((r) => !detail.get(r).onlyVersionLineDiff)
            .map((r) => rowHtml(r, realBadge))
            .join('\n') || '<div class="none">（无）</div>'
    }</div>

    <h2>仅版本号行差异（packageVersion，可视为一致）</h2>
    <div class="group">${
        modifiedRows
            .filter((r) => detail.get(r).onlyVersionLineDiff)
            .map((r) => rowHtml(r, versionBadge))
            .join('\n') || '<div class="none">（无）</div>'
    }</div>

    <h2>仅 beta@${escapeHtml(revShort)} 存在（release 缺失）</h2>
    <div class="group">${onlyBetaHtml || '<div class="none">（无）</div>'}</div>

    <h2>仅 release 存在</h2>
    <div class="group">${onlyReleaseHtml || '<div class="none">（无）</div>'}</div>

    <h2>完全相同（点击展开）</h2>
    <div class="group">${groups.same.length ? `<details class="row"><summary><span class="fname">共 ${groups.same.length} 个文件</span></summary><ul class="same-list">${sameHtml}</ul></details>` : '<div class="none">（无）</div>'}</div>
</main>
</body>
</html>
`;
}

/** 把 unified diff 文本渲染成带颜色的 HTML 行。 */
function renderPatch(patch) {
    if (patch.length > MAX_PATCH_CHARS) {
        patch = `${patch.slice(0, MAX_PATCH_CHARS)}\n…（diff 过长，已截断前 ${MAX_PATCH_CHARS} 字符）…`;
    }
    const out = [];
    for (const line of patch.split('\n')) {
        if (line.startsWith('@@')) {
            out.push(`<span class="dh">${escapeHtml(line)}</span>`);
        } else if (line.startsWith('+')) {
            out.push(`<span class="da">${escapeHtml(line)}</span>`);
        } else if (line.startsWith('-')) {
            out.push(`<span class="dd">${escapeHtml(line)}</span>`);
        } else {
            out.push(`<span class="dl">${escapeHtml(line)}</span>`);
        }
        out.push('\n');
    }
    return out.join('');
}

main();
