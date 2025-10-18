# MCP Specs Tools Test Plan

## Setup
- [ ] Meridian indexed
- [ ] Server running
- [ ] Specs path detected correctly

## Tool Tests

### 1. specs.list
**Call:** `mcp__meridian__specs_list()`
**Expected:** Array of spec objects with name, path, version, status, sections, size, last_modified
**Verify:**
- [ ] Returns non-empty array
- [ ] Contains documentation-tools-spec.md
- [ ] Contains spec.md
- [ ] Contains global-architecture-spec.md
- [ ] Each spec has all required fields

### 2. specs.get_structure
**Call:** `mcp__meridian__specs_get_structure({spec_name: "spec"})`
**Expected:** Structure with title, sections array, metadata
**Verify:**
- [ ] Returns spec structure
- [ ] Has hierarchical sections
- [ ] Metadata includes version, status
- [ ] TOC is well-formed

### 3. specs.get_section
**Call:** `mcp__meridian__specs_get_section({spec_name: "spec", section_name: "Overview"})`
**Expected:** Section content as markdown
**Verify:**
- [ ] Returns section content
- [ ] Content is not empty
- [ ] Contains expected text
- [ ] Handles subsections correctly

### 4. specs.search
**Call:** `mcp__meridian__specs_search({query: "MCP tools", max_results: 10})`
**Expected:** Array of search results with snippets
**Verify:**
- [ ] Returns relevant results
- [ ] Results have spec_name, section_title, snippet
- [ ] Snippets contain query terms
- [ ] Line numbers included

### 5. specs.validate
**Call:** `mcp__meridian__specs_validate({spec_name: "spec"})`
**Expected:** Validation result with issues and score
**Verify:**
- [ ] Returns validation object
- [ ] Has completeness_score
- [ ] Lists any issues
- [ ] Issues have severity levels

## Test Results

### Setup Results
- **Indexed:**
- **Server Status:**
- **Specs Path:**
- **Files Found:**

### Tool Test Results

#### 1. specs.list
- **Status:**
- **Notes:**

#### 2. specs.get_structure
- **Status:**
- **Notes:**

#### 3. specs.get_section
- **Status:**
- **Notes:**

#### 4. specs.search
- **Status:**
- **Notes:**

#### 5. specs.validate
- **Status:**
- **Notes:**

## Issues Found
1.
2.
3.

## Recommendations
1.
2.
3.
