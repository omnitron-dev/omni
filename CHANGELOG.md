# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.1.2] - 2026-04-03

### 🐛 Bug Fixes

- fix: relax flaky memory usage assertion in devtools test

### 📝 Other Changes

- Fix TS4111 build error: use bracket notation for process.env access
- Read CLI_VERSION from package.json instead of hardcoding
- Fix titan-redis tests: unit/integration tests all passing
- Fix titan-database tests: 240 pass, 3 remaining migration flakes
- Fix titan-redis service spec and titan-database module
- Fix titan-pm, titan-redis, titan-database tests
- Fix pre-existing test failures across monorepo
- Add docker-compose.test.yml, make test ports configurable, remove jest legacy


## [0.1.1] - 2026-04-03

### 🐛 Bug Fixes

- fix(release): add --tag latest to npm publish for version downgrade support

### 📝 Other Changes

- Add semver dependency, fix release script types, add kb to publishable packages
- Rename @omnitron/prism to @omnitron-dev/prism, fix build errors, restore KB extraction pipeline
- Add .gitignore and unified README.md across the entire monorepo
- Initial commit

