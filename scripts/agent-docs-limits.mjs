/**
 * Size limits for the files AI agents read as instructions.
 *
 * Instruction files grow one incident at a time until nobody can hold them in
 * mind: `AGENTS.md` reached 767 lines, and Codex reads at most 32 KiB of
 * project instructions by default and drops the rest without a warning. These
 * limits are the lock that keeps the condensed files small.
 *
 * To make a change fit, shorten the text. Move history to `docs/archive/` and
 * keep only the rule. CI compares this file with the base commit and refuses any
 * raised, loosened or removed limit (`agent-docs-baseline.mjs`), so a raise
 * cannot ride along with the text it lets in; it is the owner's decision. A
 * ceiling marked "may only move down" is today's size of a document still
 * waiting to be condensed.
 *
 * `pattern` is a glob over tracked paths: `**` crosses directories, `*` does not.
 */
export const AGENT_DOC_LIMITS = [
    {
        pattern: 'AGENTS.md', mustExist: true, maxLines: 150, maxBytes: 16 * 1024,
        why: 'read by every agent in every session; Codex silently cuts long files',
    },
    {
        pattern: 'CLAUDE.md', mustExist: true, maxLines: 40,
        why: 'loaded in every Claude Code session on top of AGENTS.md',
    },
    {
        pattern: '**/AGENTS.md', maxLines: 150,
        why: 'a nested AGENTS.md is read whole by agents working in that directory',
    },
    {
        pattern: '**/CLAUDE.md', maxLines: 40,
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
        pattern: 'docs/APP_BRIEF.md', mustExist: true, maxLines: 2165,
        why: 'required reading before any change; may only move down until it is condensed',
    },
    {
        pattern: 'docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md', mustExist: true, maxLines: 2617,
        why: 'required reading before UI work; may only move down until it is condensed',
    },
    {
        pattern: 'src/design-system/README.md', mustExist: true, maxLines: 447,
        why: 'required reading before UI work; may only move down until it is condensed',
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
