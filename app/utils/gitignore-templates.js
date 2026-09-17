// A hand-picked subset of the most commonly combined .gitignore rules.
// Not a mirror of github/gitignore, just enough to cover common stacks.
export const GITIGNORE_TEMPLATES = [
  {
    id: 'node',
    label: 'Node',
    body: `node_modules/\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n.pnpm-store/\ndist/\nbuild/\ncoverage/\n.env\n.env.local`,
  },
  {
    id: 'python',
    label: 'Python',
    body: `__pycache__/\n*.py[cod]\n*.egg-info/\n.venv/\nvenv/\n.mypy_cache/\n.pytest_cache/\n.ruff_cache/\ndist/\nbuild/`,
  },
  {
    id: 'java',
    label: 'Java',
    body: `*.class\n*.jar\n*.war\ntarget/\n.gradle/\nbuild/\nout/`,
  },
  {
    id: 'rust',
    label: 'Rust',
    body: `/target/\nCargo.lock`,
  },
  {
    id: 'go',
    label: 'Go',
    body: `*.exe\n*.test\n*.out\n/vendor/`,
  },
  {
    id: 'dotnet',
    label: '.NET',
    body: `bin/\nobj/\n*.user\n*.suo\n.vs/`,
  },
  {
    id: 'react',
    label: 'React / Vite',
    body: `dist/\nbuild/\n.vite/\n*.local`,
  },
  {
    id: 'macos',
    label: 'macOS',
    body: `.DS_Store\n.AppleDouble\n.LSOverride\nIcon\r`,
  },
  {
    id: 'windows',
    label: 'Windows',
    body: `Thumbs.db\nehthumbs.db\nDesktop.ini\n$RECYCLE.BIN/`,
  },
  {
    id: 'linux',
    label: 'Linux',
    body: `*~\n.directory\n.Trash-*`,
  },
  {
    id: 'vscode',
    label: 'VS Code',
    body: `.vscode/*\n!.vscode/extensions.json`,
  },
  {
    id: 'jetbrains',
    label: 'JetBrains IDEs',
    body: `.idea/\n*.iml`,
  },
];

export function buildGitignore(ids) {
  const chosen = GITIGNORE_TEMPLATES.filter((t) => ids.includes(t.id));
  return chosen.map((t) => `### ${t.label} ###\n${t.body}`).join('\n\n') + '\n';
}
