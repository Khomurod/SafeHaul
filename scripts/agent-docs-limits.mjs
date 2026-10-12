/**
 * Size limits for the files AI agents read as instructions.
 *
 * Instruction files grow one incident at a time until nobody can hold them in
 * mind: `AGENTS.md` reached 767 lines, and Codex reads at most 32 KiB of
 * project instructions by default and drops the rest without a warning.
 *
 * Only the files every session loads are refused past their limits: `AGENTS.md`
 * and `CLAUDE.md` (`hard: true`), and the two together. Every other limit warns.
 * `test-agent-docs.mjs` pins the refused limits, so raising one changes that test
 * too; that is the owner's decision. To make a change fit, shorten the text: move
 * history to `docs/archive/` and keep only the rule.
 *
 * `pattern` is a glob over tracked paths: `**` crosses directories, `*` does not.
 */
export const AGENT_DOC_LIMITS = [
    {
        pattern: 'AGENTS.md', mustExist: true, hard: true, maxLines: 150, maxBytes: 16 * 1024,
        why: 'read by every agent in every session; Codex silently cuts long files',
    },
    {
        pattern: 'CLAUDE.md', mustExist: true, hard: true, maxLines: 40,
        why: 'loaded in every Claude Code session on top of AGENTS.md',
    },
    {
        pattern: '*/**/AGENTS.md', maxLines: 150,
        why: 'a nested AGENTS.md is read whole by agents working in that directory',
    },
    {
        pattern: '*/**/CLAUDE.md', maxLines: 40,
        why: 'a nested CLAUDE.md is read whole when Claude opens files there',
    },
    {
        pattern: '.claude/rules/**/*.md', mustExist: true, maxLines: 150, requirePaths: true,
        why: 'loaded whole when Claude opens a matching file',
    },
    {
        pattern: '.claude/skills/**/SKILL.md', maxLines: 200,
        why: 'loaded whole when Claude picks the skill',
    },
    {
        pattern: '.agents/skills/**/SKILL.md', maxLines: 200,
        why: 'loaded whole when Codex picks the skill',
    },
    {
        pattern: 'docs/APP_BRIEF.md', mustExist: true, maxLines: 1500, maxBytes: 94 * 1024,
        why: 'required reading before any change; history belongs in docs/archive/',
    },
    {
        pattern: 'docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md', mustExist: true, maxLines: 560, maxBytes: 50 * 1024,
        why: 'required reading before UI work; history belongs in docs/archive/',
    },
    {
        pattern: 'src/design-system/README.md', mustExist: true, maxLines: 180, maxBytes: 14 * 1024,
        why: 'required reading before UI work; history belongs in docs/archive/',
    },
    {
        pattern: '.github/pull_request_template.md', mustExist: true, maxLines: 45,
        why: 'every agent fills it in for every change, and the owner reads its summary',
    },
    {
        pattern: 'docs/OWNER_GUIDE.md', mustExist: true, maxLines: 80,
        why: "the owner's one page on working with agents and releasing",
    },
    {
        pattern: 'docs/RELEASE_CHECKLIST.md', mustExist: true, maxLines: 60,
        why: 'a ten-minute check the owner runs before every release',
    },
];

/** Loaded together at the start of every Claude Code session. */
export const ALWAYS_LOADED = ['CLAUDE.md', 'AGENTS.md'];

/** Well inside Codex's 32 KiB default, leaving room for a user's own global file. */
export const ALWAYS_LOADED_MAX_BYTES = 24 * 1024;
