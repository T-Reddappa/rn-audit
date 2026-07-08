# rn-audit

> Static analysis and performance auditing for React Native and Expo projects.

[![npm version](https://img.shields.io/npm/v/rn-audit.svg)](https://www.npmjs.com/package/rn-audit)
[![CI](https://github.com/treddappa/rn-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/treddappa/rn-audit/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/rn-audit.svg)](LICENSE)

**rn-audit** is a CLI tool that scans React Native and Expo projects for performance issues, accessibility problems, bundle-size regressions, and architectural anti-patterns — before they reach production.

```bash
npx rn-audit
```

---

## Status

🚧 **Pre-release (v0.0.0)** — Project scaffold in progress. The tool prints a placeholder message. Static analysis rules are coming in the next milestone.

---

## Installation

```bash
npm install -g rn-audit
```

Or run without installing:

```bash
npx rn-audit
```

---

## Usage

```bash
# Run a full audit (coming soon)
rn-audit

# Show version
rn-audit --version

# Show help
rn-audit --help
```

---

## Planned Features

- **Static Analysis**: Scan source files for React Native performance patterns (inline styles, missing `keyExtractor`, unoptimized images, nested ScrollViews, and more)
- **Performance Scoring**: A 0–100 score to track project health over time
- **Multiple Output Formats**: Terminal, JSON, HTML, SARIF, Markdown, GitHub Actions annotations
- **Zero Configuration**: Sensible defaults; override what you need
- **Plugin System**: Third-party rules and shareable configs (Phase 2)
- **CI Integration**: Quality gates that block regressions before they merge

See [DESIGN_DOCUMENT.md](./DESIGN_DOCUMENT.md) for the full architecture and roadmap.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and development workflow.

---

## License

[Apache 2.0](./LICENSE)
