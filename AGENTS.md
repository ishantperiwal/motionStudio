# Motion Studio — for agents other than Claude (Codex, Antigravity, …)

Follow [CLAUDE.md](CLAUDE.md): it is the working agreement for every agent in this studio. Where it says Claude, read
your own name.

- Your agent id: `codex` or `antigravity`.
- Wait for the editor's Send with `node tools/wait-for-notes.mjs --agent <your id>` (in the background; start it again
  after each send).
- Work only notes whose `sentTo` is your id. A note sent to another agent (or with no `sentTo`, which is Claude's) is
  theirs: leave it, even if it sits in the same scene.
