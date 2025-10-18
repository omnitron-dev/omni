# Specification Restructuring Plan
# Meridian Documentation Reorganization Proposal

**Version**: 1.0.0
**Created**: October 18, 2025
**Status**: Proposal
**Author**: Claude Code Agent (Self-Analysis)

---

## Executive Summary

Based on the comprehensive analysis in [SPEC_ANALYSIS.md](./SPEC_ANALYSIS.md), this plan proposes a **minor restructuring** of Meridian's specification ecosystem to improve maintainability, accessibility, and consistency.

**Severity**: 🟡 **Low-to-Medium** (Current structure is functional, improvements are incremental)

**Impact**: ✅ **Low Risk** (Non-breaking changes, additive improvements)

**Timeline**: 2-4 hours total work

---

## Current Issues

### Issue 1: Version Numbering Inconsistency

**Problem**: spec.md lacks explicit version number
- **Current**: "Production Specification" label
- **Other specs**: Explicit versions (1.0.0, 2.0.0)
- **Impact**: Medium - Confusion about which version of spec.md aligns with other docs

**Severity**: 🟡 Medium

### Issue 2: Language Barrier

**Problem**: 3 of 4 specifications in Russian
- **Specs**: spec.md, strong-tools-spec.md, global-architecture-spec.md
- **Impact**: High - Limits international accessibility
- **Current**: Only roadmap.md in English

**Severity**: 🟠 High

### Issue 3: RocksDB Schema Duplication

**Problem**: Schema defined in multiple places
- **Locations**: spec.md (lines 514-531), global-architecture-spec.md (lines 1188-1277)
- **Impact**: Medium - Risk of divergence, maintenance burden

**Severity**: 🟡 Medium

### Issue 4: Implementation Plan Duplication

**Problem**: 7-phase plan repeated in 3 specs
- **Locations**: spec.md, strong-tools-spec.md, global-architecture-spec.md
- **Impact**: Medium - Updates required in 3 places
- **Current State**: Roadmap.md is most detailed

**Severity**: 🟡 Medium

### Issue 5: Missing Cross-References

**Problem**: Specs don't reference each other consistently
- **Example**: spec.md doesn't reference strong-tools-spec.md for doc generation
- **Impact**: Low - Users might miss related content

**Severity**: 🟢 Low

### Issue 6: No Central Entry Point

**Problem**: No README or overview document
- **Current**: INDEX.md now exists (created today)
- **Impact**: Low - Now mitigated

**Severity**: ✅ Resolved (INDEX.md created)

---

## Proposed Structure

### Option A: Minimal Changes (Recommended)

**Approach**: Keep current structure, add supplementary files

```
specs/
├── README.md                          # NEW - Entry point, directs to INDEX.md
├── INDEX.md                           # ✅ CREATED - Central navigation
├── SPEC_ANALYSIS.md                   # ✅ CREATED - Quality analysis
├── RESTRUCTURING_PLAN.md             # ✅ CREATED - This file
│
├── core/                              # NEW - Group core specs
│   ├── spec.md                        # MOVED - Core specification
│   ├── spec-en.md                     # NEW - English translation
│   └── CHANGELOG.md                   # NEW - Version history
│
├── features/                          # NEW - Feature specs
│   ├── strong-tools-spec.md           # MOVED
│   ├── strong-tools-spec-en.md        # NEW - English translation
│   ├── global-architecture-spec.md    # MOVED
│   └── global-architecture-spec-en.md # NEW - English translation
│
├── implementation/                    # NEW - Implementation docs
│   ├── roadmap.md                     # MOVED - Implementation roadmap
│   ├── phases/                        # NEW - Per-phase details
│   │   ├── phase-0-foundation.md
│   │   ├── phase-1-global-arch.md
│   │   ├── phase-2-mcp-integration.md
│   │   ├── phase-3-doc-generation.md
│   │   ├── phase-4-example-test-gen.md
│   │   ├── phase-5-cross-monorepo.md
│   │   ├── phase-6-agents.md          # Deferred to v2.1
│   │   ├── phase-7-auto-update.md     # Deferred to v2.1
│   │   └── phase-8-production.md
│   └── TESTING.md                     # NEW - Testing strategy details
│
└── schemas/                           # NEW - Single source of truth
    ├── rocksdb-schema.md             # NEW - Consolidated schema
    ├── mcp-tools-catalog.md          # NEW - All 57 tools
    └── data-structures.md            # NEW - Type definitions
```

**Pros**:
- ✅ Clearer organization
- ✅ Single source of truth for schemas
- ✅ English translations separate from originals
- ✅ Phase-by-phase details accessible

**Cons**:
- ⚠️ Breaks existing links (mitigated by redirects in INDEX.md)
- ⚠️ More directories to navigate

**Recommendation**: ✅ **Adopt with modifications** (see Option C)

### Option B: Flat Structure with Prefixes

**Approach**: Keep all specs in one directory, use naming convention

```
specs/
├── 00-README.md                       # Entry point
├── 01-INDEX.md                        # Central navigation
├── 02-SPEC_ANALYSIS.md               # Analysis
│
├── core-spec.md                       # Renamed
├── core-spec-en.md                    # NEW
├── core-CHANGELOG.md                  # NEW
│
├── feature-strong-tools.md            # Renamed
├── feature-strong-tools-en.md         # NEW
├── feature-global-architecture.md     # Renamed
├── feature-global-architecture-en.md  # NEW
│
├── impl-roadmap.md                    # Renamed
├── impl-testing.md                    # NEW
│
├── schema-rocksdb.md                  # NEW
├── schema-mcp-tools.md                # NEW
└── schema-data-structures.md          # NEW
```

**Pros**:
- ✅ Simpler navigation (everything in one place)
- ✅ Clear naming convention

**Cons**:
- ⚠️ Still requires renaming
- ⚠️ Can get cluttered as docs grow

**Recommendation**: 🟡 **Consider for smaller projects only**

### Option C: Hybrid Minimal (Recommended)

**Approach**: Minimal changes, add only what's necessary

```
specs/
├── README.md                          # NEW - Quick start, points to INDEX.md
├── INDEX.md                           # ✅ CREATED - Master navigation
├── SPEC_ANALYSIS.md                   # ✅ CREATED - Quality analysis
├── RESTRUCTURING_PLAN.md             # ✅ CREATED - This file
│
├── spec.md                            # KEEP - Core spec (add v2.0.0 label)
├── spec-en.md                         # NEW - English translation
├── strong-tools-spec.md               # KEEP
├── strong-tools-spec-en.md            # NEW - English translation
├── global-architecture-spec.md        # KEEP
├── global-architecture-spec-en.md     # NEW - English translation
├── roadmap.md                         # KEEP
│
├── schemas/                           # NEW - Consolidated schemas
│   ├── rocksdb-schema.md             # NEW - Single source
│   ├── mcp-tools-catalog.md          # NEW - All 57 tools
│   └── type-definitions.md           # NEW - TypeScript/Rust types
│
├── guides/                            # NEW - User guides
│   ├── getting-started.md            # NEW
│   ├── multi-monorepo-setup.md       # NEW
│   ├── mcp-integration.md            # NEW
│   └── testing-guide.md              # NEW
│
└── CHANGELOG.md                       # NEW - Spec version history
```

**Pros**:
- ✅ Minimal disruption (most files stay in place)
- ✅ Backward compatible links
- ✅ Adds only essential structure
- ✅ English translations available

**Cons**:
- ⚠️ Less organized than Option A

**Recommendation**: ✅ **ADOPT THIS** (best balance of improvement vs. disruption)

---

## Migration Steps

### Phase 1: Immediate Fixes (30 minutes)

**No file moves, only additions and edits**

1. ✅ **Create INDEX.md** - DONE
2. ✅ **Create SPEC_ANALYSIS.md** - DONE
3. ✅ **Create RESTRUCTURING_PLAN.md** - DONE (this file)

4. **Add version to spec.md** (5 minutes)
   ```markdown
   # Meridian: Когнитивная система памяти для работы LLM с кодовыми базами

   **Версия**: v2.0.0                    # ADD THIS LINE
   **Дата**: 17 октября 2025
   **Статус**: Production Specification
   ```

5. **Create README.md** (10 minutes)
   ```markdown
   # Meridian Specifications

   Welcome to Meridian's specification ecosystem!

   **Quick Start**: See [INDEX.md](./INDEX.md) for navigation.

   **Status**: v2.0 Production-Ready (78% implemented)

   ## Core Documents

   - [spec.md](./spec.md) - Core system (Russian)
   - [roadmap.md](./roadmap.md) - Implementation status (English)
   - [INDEX.md](./INDEX.md) - Master index

   ## Languages

   - 🇷🇺 Russian: spec.md, strong-tools-spec.md, global-architecture-spec.md
   - 🇬🇧 English: roadmap.md, INDEX.md, SPEC_ANALYSIS.md
   - 🚧 English translations: Coming soon

   ## Contributing

   See [SPEC_ANALYSIS.md](./SPEC_ANALYSIS.md) for quality guidelines.
   ```

6. **Add cross-references to spec.md** (15 minutes)
   Add at end of Introduction section:
   ```markdown
   ### Related Specifications

   - **[Strong Tools](./strong-tools-spec.md)**: Documentation generation, examples, tests
   - **[Global Architecture](./global-architecture-spec.md)**: Multi-monorepo support
   - **[Roadmap](./roadmap.md)**: Implementation status and planning
   - **[INDEX](./INDEX.md)**: Complete specification index
   ```

### Phase 2: Schema Consolidation (1 hour)

**Create single source of truth for schemas**

7. **Create schemas/rocksdb-schema.md** (30 minutes)
   - Extract from spec.md (lines 514-531)
   - Extract from global-architecture-spec.md (lines 1188-1277)
   - Merge and reconcile differences
   - Add versioning (v1.0 schema, v2.0 schema)

8. **Create schemas/mcp-tools-catalog.md** (20 minutes)
   - All 57 tools in one place
   - Categorized by function
   - Implementation status for each
   - Cross-references to spec definitions

9. **Create schemas/type-definitions.md** (10 minutes)
   - TypeScript interfaces
   - Rust structs
   - JSON schemas
   - Single source of truth

10. **Update specs to reference schemas/** (10 minutes)
    ```markdown
    For RocksDB schema details, see [schemas/rocksdb-schema.md](./schemas/rocksdb-schema.md).
    For MCP tool catalog, see [schemas/mcp-tools-catalog.md](./schemas/mcp-tools-catalog.md).
    ```

### Phase 3: English Translations (4-8 hours)

**Priority translations**

11. **Translate spec.md → spec-en.md** (3 hours)
    - Machine translation + manual review
    - Keep original Russian version
    - Add language switcher in both

12. **Translate strong-tools-spec.md → strong-tools-spec-en.md** (3 hours)

13. **Translate global-architecture-spec.md → global-architecture-spec-en.md** (2 hours)

**Language Switcher Example**:
```markdown
# Meridian: Cognitive Memory System for LLM Code Work

**Language**: 🇬🇧 English | [🇷🇺 Русский](./spec.md)
```

### Phase 4: User Guides (2 hours)

**Practical guides for users**

14. **Create guides/getting-started.md** (30 minutes)
    - Quick start for new users
    - Installation
    - First indexing
    - Claude Code integration

15. **Create guides/multi-monorepo-setup.md** (30 minutes)
    - Setting up global server
    - Registering monorepos
    - Cross-repo documentation access

16. **Create guides/mcp-integration.md** (30 minutes)
    - MCP server configuration
    - Tool usage examples
    - Troubleshooting

17. **Create guides/testing-guide.md** (30 minutes)
    - Running tests
    - Test structure
    - Adding new tests

### Phase 5: Changelog (30 minutes)

18. **Create CHANGELOG.md**
    ```markdown
    # Meridian Specifications Changelog

    ## v2.0.0 - October 18, 2025

    ### Added
    - Global architecture specification
    - Strong tools specification
    - Cross-monorepo support
    - 28 new MCP tools (23 strong + 5 global)

    ### Changed
    - Upgraded to MCP Protocol 2025-03-26
    - Custom MCP implementation (no SDK)

    ### Completed
    - All 7 implementation phases
    - 431/431 tests passing (100%)
    - 29 core MCP tools production-ready

    ## v1.0.0 - Previous Release

    - Initial production release
    - 29 core MCP tools
    - Single-monorepo support
    ```

---

## Implementation Priority

### High Priority (Do Now)

1. ✅ Create INDEX.md - DONE
2. ✅ Create SPEC_ANALYSIS.md - DONE
3. ✅ Create RESTRUCTURING_PLAN.md - DONE
4. Add version to spec.md (v2.0.0)
5. Create README.md (entry point)
6. Add cross-references to all specs

**Estimated Time**: ✅ 3/6 done, 30 minutes remaining

**Impact**: High (accessibility, navigation)

### Medium Priority (Do This Week)

7. Create schemas/ directory
8. Consolidate RocksDB schema
9. Create MCP tools catalog
10. Create type definitions
11. Update specs to reference schemas/

**Estimated Time**: 1 hour

**Impact**: Medium (maintainability, consistency)

### Low Priority (Do This Month)

12. Translate spec.md to English
13. Translate strong-tools-spec.md to English
14. Translate global-architecture-spec.md to English
15. Create user guides (4 guides)
16. Create CHANGELOG.md

**Estimated Time**: 6-10 hours

**Impact**: Medium (accessibility for international users)

### Nice to Have (Future)

17. Create phase-by-phase details in implementation/phases/
18. Add architecture diagrams (Mermaid)
19. Create video walkthroughs
20. Set up automated spec validation

**Estimated Time**: Variable (ongoing)

**Impact**: Low (nice to have, not critical)

---

## Risk Assessment

### Low Risks ✅

| Risk | Mitigation |
|------|------------|
| Broken links | INDEX.md provides redirects |
| File moves | Keep originals, add copies |
| Translation quality | Machine + manual review |

### Medium Risks 🟡

| Risk | Mitigation |
|------|------------|
| Duplication with translations | Clear naming convention |
| Maintenance of 2 languages | Primary is Russian, English is derived |
| Schema divergence | Single source in schemas/ |

### No High Risks 🟢

All changes are additive and non-breaking.

---

## Success Criteria

### After Phase 1 (Immediate Fixes)

- ✅ INDEX.md exists and provides navigation
- ✅ SPEC_ANALYSIS.md provides quality insights
- [ ] spec.md has version number (v2.0.0)
- [ ] README.md exists as entry point
- [ ] All specs cross-reference each other

### After Phase 2 (Schema Consolidation)

- [ ] schemas/ directory exists
- [ ] Single RocksDB schema source
- [ ] Single MCP tools catalog
- [ ] No schema duplication in specs

### After Phase 3 (English Translations)

- [ ] All 3 major specs have English versions
- [ ] Language switchers in place
- [ ] INDEX.md updated with English links

### After Phase 4 (User Guides)

- [ ] 4 user guides available
- [ ] Getting started guide for new users
- [ ] Multi-monorepo setup guide
- [ ] MCP integration guide

### Final State

- [ ] Clear structure with minimal reorganization
- [ ] English accessibility for all specs
- [ ] Single source of truth for schemas
- [ ] Comprehensive user guides
- [ ] Version history tracked

---

## Backward Compatibility

### Links

**All existing links continue to work**:
- `specs/spec.md` → Still exists
- `specs/strong-tools-spec.md` → Still exists
- `specs/global-architecture-spec.md` → Still exists
- `specs/roadmap.md` → Still exists

**New links added**:
- `specs/INDEX.md` → Navigation hub
- `specs/README.md` → Entry point
- `specs/schemas/` → Schemas
- `specs/guides/` → User guides

### Git History

**Preserved**:
- All files keep git history
- Translations are new files (not renames)
- Schema consolidation creates new file, keeps originals

### Tools

**No tool changes required**:
- Meridian MCP server doesn't reference specs
- CLI doesn't parse spec files
- No breaking changes

---

## Alternatives Considered

### Alternative 1: Do Nothing

**Pros**:
- No work required
- No risk of breaking anything

**Cons**:
- Issues persist (language barrier, duplication)
- Maintenance burden continues

**Verdict**: ❌ Not recommended

### Alternative 2: Complete Restructure (Option A)

**Pros**:
- Perfect organization
- Clean separation of concerns

**Cons**:
- High effort (file moves)
- Breaks existing links
- Higher risk

**Verdict**: 🟡 Overkill for current needs

### Alternative 3: Minimal Hybrid (Option C) ✅

**Pros**:
- Low effort, high impact
- Backward compatible
- Addresses key issues

**Cons**:
- Not as clean as Option A

**Verdict**: ✅ Recommended (best balance)

---

## Timeline

### Week 1 (Now)

- Day 1: ✅ Create INDEX.md, SPEC_ANALYSIS.md, RESTRUCTURING_PLAN.md (DONE)
- Day 2: Add version, README, cross-references (30 min)
- Day 3-5: Schema consolidation (1 hour)

**Deliverable**: Immediate improvements live

### Week 2-3

- Week 2: English translation of spec.md (3 hours)
- Week 3: English translations of other specs (5 hours)

**Deliverable**: English accessibility

### Week 4

- Create user guides (2 hours)
- Create CHANGELOG.md (30 min)

**Deliverable**: Complete restructuring

### Total Effort

**Estimated**: 6-10 hours over 4 weeks
**Priority Work**: First 2 hours (high impact)

---

## Maintenance Plan

### Regular Updates

**Weekly**:
- Update roadmap.md with progress
- Update INDEX.md with status changes

**Per Phase**:
- Update CHANGELOG.md
- Update implementation status in specs

**Per Release**:
- Bump version numbers
- Update version history table
- Tag in git

### Review Schedule

**Quarterly**:
- Review spec quality
- Check for outdated content
- Update recommendations

**Annual**:
- Full specification audit
- Restructuring review
- Community feedback integration

---

## Conclusion

This restructuring plan provides a **pragmatic, low-risk approach** to improving Meridian's specification ecosystem. By focusing on high-impact, low-effort changes, we can significantly improve accessibility and maintainability without disrupting existing workflows.

**Key Principles**:
- ✅ Backward compatible (no breaking changes)
- ✅ Incremental improvements (phased approach)
- ✅ Minimal disruption (keep existing structure mostly intact)
- ✅ High value (address key pain points)

**Recommended Action**: ✅ **Proceed with Option C (Hybrid Minimal)**

**Next Steps**:
1. Review and approve this plan
2. Execute Phase 1 (30 minutes)
3. Schedule Phase 2 (1 hour this week)
4. Plan Phase 3 (translations over 2-3 weeks)

**Expected Outcome**: Well-organized, accessible, maintainable specification ecosystem that serves both Russian and international users.

---

## Appendix: Before/After Comparison

### Before (Current)

```
specs/
├── spec.md                            # Russian, no version number
├── strong-tools-spec.md               # Russian, v1.0.0
├── global-architecture-spec.md        # Russian, v2.0.0
└── roadmap.md                         # English, v1.0.0
```

**Issues**:
- No central navigation
- No English for core specs
- No schema consolidation
- No user guides

### After (Proposed)

```
specs/
├── README.md                          # NEW - Entry point
├── INDEX.md                           # NEW - Navigation hub
├── SPEC_ANALYSIS.md                   # NEW - Quality analysis
├── RESTRUCTURING_PLAN.md             # NEW - This plan
├── CHANGELOG.md                       # NEW - Version history
│
├── spec.md                            # Updated - Added v2.0.0
├── spec-en.md                         # NEW - English translation
├── strong-tools-spec.md               # Unchanged
├── strong-tools-spec-en.md            # NEW - English translation
├── global-architecture-spec.md        # Unchanged
├── global-architecture-spec-en.md     # NEW - English translation
├── roadmap.md                         # Unchanged
│
├── schemas/                           # NEW - Single source
│   ├── rocksdb-schema.md
│   ├── mcp-tools-catalog.md
│   └── type-definitions.md
│
└── guides/                            # NEW - User guides
    ├── getting-started.md
    ├── multi-monorepo-setup.md
    ├── mcp-integration.md
    └── testing-guide.md
```

**Improvements**:
- ✅ Central navigation (INDEX.md, README.md)
- ✅ English translations available
- ✅ Schema consolidation (schemas/)
- ✅ User guides (guides/)
- ✅ Version tracking (CHANGELOG.md)
- ✅ Quality analysis (SPEC_ANALYSIS.md)

---

**Plan Version**: 1.0.0
**Created**: October 18, 2025
**Author**: Claude Code Agent (Sonnet 4.5)
**Status**: Proposal for review and approval
