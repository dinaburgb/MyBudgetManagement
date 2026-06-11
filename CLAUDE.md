# MyBudgetManagement - Claude Guidelines

## Git Workflow
- **NEVER commit directly to `master`**
- Always create a dedicated branch before making any changes
- Branch naming: use descriptive names (e.g., `feature/expense-tracking`, `fix/category-filter`)
- `master` is the source of truth — keep it clean and stable
- After finishing work on a branch, ask me whether to **merge directly to `master`** (no PRs — solo project)
- Delete branch after merge

## Working Style
- The user has very basic programming skills
- **Work autonomously — implement changes directly without asking for approval first**
- **Only two actions require explicit user approval: merge to master, and git push**
- Confirm before any destructive git operations (reset, force push)
- When in doubt about keeping or discarding changes, explain the impact and ask
- User works alone — no need for PRs or code reviews
- Create and maintain docs/PROJECT_PLAN.md file that keeps the latest status
- Periodically suggest to update the docs/PROJECT_PLAN.md file

## Communication Rules
- **All explanations, summaries, and messages to the user must be in Hebrew only — no English words**
- מונחים טכניים שאין להם תרגום (כגון שמות קבצים, שמות פונקציות, ערכים בקוד) — מותר לציינם כמות שהם
- בקוד עצמו — ניתן להשתמש באנגלית (שמות משתנים, הערות טכניות); ההגבלה חלה רק על הטקסט שנכתב למשתמש

## Project Notes
- Local personal finance dashboard for private family budget management
- Database: SQLite (local only, no cloud sync)
- No real bank credentials in Git
- Manual data entry flow
- Prefer test code over running the app directly
- In case of fixed bugs give the user instructions how to check in application
- If the user gives unclear input ask him to clarify or provide screen capture
- Avoid UTF-8 BOM in Python files
- All test code files should be in /tests/ folder
