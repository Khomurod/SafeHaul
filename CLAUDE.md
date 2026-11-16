# Claude Code — project instructions

@AGENTS.md

## Claude Code specifics

- The two skills `AGENTS.md` §5 names are `/implement` and `/check-and-report`
  here.
- The topic rules in `.claude/rules/` load on their own when you open a matching
  file. When you only run commands in an area — a browser suite, a deploy check —
  open the file that `AGENTS.md` §5 names.
- A cloud session installs the dependencies by itself at start
  (`.claude/hooks/session-start.sh`). Anywhere else, the install row of
  `AGENTS.md` §4 applies.
