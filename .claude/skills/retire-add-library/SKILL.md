---
name: retire-add-library
description: Add a new JavaScript library to the retire.js vulnerability database. Given a library name, looks it up on CDNs, downloads multiple versions, finds version strings, generates detection regexes with (§§version§§) placeholder, adds entries to jsrepository-master.json and testcases.json, and runs validate/test-detection. Use this skill whenever adding a new library to retire.js, generating filecontent/filename/uri extractors, or finding version detection patterns for a JS library.
---

# retire-add-library

This skill adds a new JavaScript library to the retire.js vulnerability database. It downloads real files from CDNs, finds where version strings appear, builds and tests regex patterns against those files, and writes validated entries to the repository.

The repo is at `/Users/erlend/code/github/RetireJS/retire.js`. All file edits and validation commands run there.

## Overview

The key constraint: `(§§version§§)` is retire.js-specific syntax and won't match against real files. So you must **test regexes using the actual version number first**, then replace the version with `(§§version§§)` only after tests pass.

## Step 1 — CDN Lookup

Fetch library metadata from cdnjs:

```
https://api.cdnjs.com/libraries/{NAME}?fields=name,versions,filename,description,homepage
```

This returns all available versions and the canonical filename (e.g. `lodash.min.js`). If the library isn't on cdnjs, try jsdelivr:

```
https://data.jsdelivr.com/v1/packages/npm/{NAME}
```

Note the `filename` field (minified) and derive the non-minified name by stripping `.min` (e.g. `lodash.min.js` → `lodash.js`). If cdnjs doesn't have a `.min` in the filename, treat that as the non-minified version and look for a `.min.js` variant.

## Step 2 — Select Versions

Pick 4–5 versions spread across the history: 1 early (but not the first), 2–3 in the middle, and the latest. You'll download both minified and non-minified for each.

## Step 3 — Download Files

```bash
mkdir -p /tmp/retire-{NAME}
# For each VERSION:
curl -sL "https://cdnjs.cloudflare.com/ajax/libs/{NAME}/{VERSION}/{MIN_FILENAME}" \
  -o /tmp/retire-{NAME}/{VERSION}.min.js
curl -sL "https://cdnjs.cloudflare.com/ajax/libs/{NAME}/{VERSION}/{UNMIN_FILENAME}" \
  -o /tmp/retire-{NAME}/{VERSION}.js
```

Verify each file downloaded successfully (non-zero size, not an HTML error page):
```bash
ls -la /tmp/retire-{NAME}/
head -3 /tmp/retire-{NAME}/{VERSION}.js
```

A suspicious file size (e.g. ~146 bytes) almost always means a 404 HTML response — check with `head`. If cdnjs returns 404 for a version (even one listed in its metadata), fall back to jsDelivr:
```bash
curl -sL "https://cdn.jsdelivr.net/npm/{NAME}@{VERSION}/dist/{FILENAME}" \
  -o /tmp/retire-{NAME}/{VERSION}.js
```
Only include versions in testcases.json that successfully downloaded from the CDN URL used in the test template.

## Step 4 — Find Version Strings

Search each file for the exact version string:
```bash
grep -n "1\.2\.3" /tmp/retire-{NAME}/{VERSION}.js
grep -n "1\.2\.3" /tmp/retire-{NAME}/{VERSION}.min.js
```

Do this for all downloaded versions to see how and where the version appears.

## Step 5 — Identify Unique Context

**Non-minified files**: Check the first 30 lines for block or line comments containing the library name and version:
```bash
head -30 /tmp/retire-{NAME}/{VERSION}.js
```
A comment like `/*! Lodash v4.17.21` or `// MyLib JavaScript Library v1.2.3` is the ideal match — the library name provides uniqueness.

**Minified files**: The version is often in a short string assignment. Use grep with context to see what's nearby:
```bash
grep -o ".{0,60}1\.2\.3.{0,60}" /tmp/retire-{NAME}/{VERSION}.min.js
```

**Watch out**: some libraries (including newer major versions) ship both `lib.js` and `lib.min.js` as fully minified single-line files. `grep -o` with `.{0,N}` can fail with "exceeds complexity limits" on large one-liners. Use Python instead:
```bash
python3 -c "
import re
with open('/tmp/retire-{NAME}/{VERSION}.min.js', 'r', errors='replace') as f:
    content = f.read()
for m in re.findall(r'.{0,80}1\.2\.3.{0,80}', content)[:5]:
    print(m)
"
```

Look for the library's own name, a unique property (e.g. `lodash.VERSION`), or a characteristic string adjacent to the version. Prefer patterns where the library name appears.

**If the version format changed between major versions** (e.g. 0.x/1.x embedded it in a header comment, 2.x moved it to a code property), write separate filecontent patterns for each era rather than forcing one pattern to cover all versions.

## Step 6 — Write Candidate Regexes (with real version numbers)

Write candidate regexes using the **actual version number** — escape dots and regex metacharacters in the surrounding context. Do NOT use `§§version§§` yet.

Examples:
```
Non-minified comment: /\*!? Lodash v4\.17\.21
Minified property:    [^a-z]lodash\.VERSION="4\.17\.21"
```

## Step 7 — Test Regexes Against All Downloaded Files

For each candidate regex, verify it matches across all versions (substituting each version's actual number):
```bash
grep -oP '/\*!? Lodash v4\.17\.21' /tmp/retire-{NAME}/{VERSION}.js
```

A good regex matches consistently across all tested versions (with the version number swapped). Refine patterns that fail — look for stable surrounding text that doesn't change between versions.

**Regex quality rules:**
- Generic patterns like `version="1\.2\.3"` or `static version=` are too broad — they will likely appear in unrelated libraries. Always anchor with library-specific identifiers visible in the surrounding context (library name, unique module names, characteristic property names).
- Examine context on **both sides** of the version string. Prefer identifiers that are unique to that library (e.g. Quill's `delta` and `parchment` imports).
- Any unbounded quantifier over a character class — `[^,]+`, `[^"]*`, `.+` — **must** be size-limited: `[^,]{1,20}`, `[^"]{1,30}`, `.{1,50}`. Unbounded quantifiers risk catastrophic backtracking and are a code-quality red flag.

## Step 8 — Replace Version with `(§§version§§)`

Only after tests pass, replace the concrete version literal with `(§§version§§)`. This **must be the only capturing group** — convert any other `(...)` to `(?:...)`.

```
/\*!? Lodash v4\.17\.21   →   /\*!? Lodash v(§§version§§)
[^a-z]lodash\.VERSION="4\.17\.21"  →  [^a-z]lodash\.VERSION="(§§version§§)"
```

Also generate filename and uri patterns (adjust if the actual URL/filename structure differs):
```
filename:  lodash-(§§version§§)(?:\.min)?\.js
uri:       /(§§version§§)/lodash(?:\.min)?\.js
```

## Step 9 — Add Entry to jsrepository-master.json

Edit `/Users/erlend/code/github/RetireJS/retire.js/repository/jsrepository-master.json`.

Insert the new entry **immediately before** the `"dont check"` key at the end of the file. The `vulnerabilities` field is an empty array — vulnerability details get added separately later.

```json
"LIBRARY_NAME": {
  "npmname": "npm-package-name",
  "vulnerabilities": [],
  "extractors": {
    "filename": ["LIBRARY_NAME-(§§version§§)(?:\\.min)?\\.js"],
    "filecontent": ["REGEX_1", "REGEX_2"],
    "uri": ["/(§§version§§)/LIBRARY_NAME(?:\\.min)?\\.js"]
  }
},
```

## Step 10 — Add Entry to testcases.json

Edit `/Users/erlend/code/github/RetireJS/retire.js/repository/testcases.json`.

Add the library before the closing `}`. The last existing entry in the file needs a comma after its closing brace. Use cdnjs CDN URLs with `§§version§§` and `§§subversion§§` placeholders. Include the 3–5 tested versions:

```json
"LIBRARY_NAME": {
  "https://cdnjs.cloudflare.com/ajax/libs/LIBRARY_NAME/§§version§§/FILENAME§§subversion§§.js": {
    "versions": ["VERSION_1", "VERSION_2", "VERSION_3"],
    "subversions": ["", ".min"]
  }
}
```

Adjust the URL template if minified/non-minified files differ in path rather than just a `.min` suffix.

## Step 11 — Validate and Test

Run from the repository directory:

```bash
cd /Users/erlend/code/github/RetireJS/retire.js/repository
./convertToVersioned && ./validate
./convertToVersioned && node test-detection.js LIBRARY_NAME
./convertToVersioned && node test-detection.js
```

**Fixing failures:**
- `validate` errors: likely means `§§version§§` is not the only capture group, or there's a JSON syntax error — check the regex for extra `(...)` groups
- `node test-detection.js LIBRARY_NAME` failures: the regex doesn't match the downloaded URLs/files — refine the pattern
- `node test-detection.js` (no arg) unexpected matches: the regex is too broad — add more library-specific context to narrow it

Iterate until all three commands pass cleanly.

## Step 12 — Report Results

Show the final extractors added to the repo and summarize the test results (which versions were detected, which commands passed).
