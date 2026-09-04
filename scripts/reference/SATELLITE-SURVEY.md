# Satellite source survey

This opt-in build tool surveys authoritative identities and SPK descriptors. It
does **not** add selectable bodies, select a preferred solution, evaluate state
vectors, or certify complete physical coverage. It is never run on app startup.

```sh
node scripts/survey-satellite-ephemerides.mjs --output NEW_DIRECTORY --discovery FROZEN_DISCOVERY_HTML --from 2020-01-01 --to 2031-01-01
node scripts/survey-satellite-ephemerides.mjs --verify NEW_DIRECTORY
```

Inputs are the [JPL ephemeris table](https://ssd.jpl.nasa.gov/sats/ephem/), its
linked original SPKs, and the verified
[public BSP directory](https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/).
The directory's `tnosat_*` files are also inspected, including alternative
versions; inclusion is not source precedence. Other unlisted directory files
are **not** automatically surveyed. The supplied discovery HTML is a frozen
copy of the [JPL discovery table](https://ssd.jpl.nasa.gov/sats/discovery.html).

Every run creates a new directory and retains raw pages, source validators,
header/summary/comment byte ranges, hashes, target/center/frame/type/bounds,
source errors and per-body classifications. Comments are decoded according to
[NAIF DAFEC](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/dafec_c.html).
Embedded name/number pairs must also appear in actual segment descriptors.
Source dynamical GM parameters, including zero, are not asserted measured
physical masses.

Reconciliation compares explicit names/designations/aliases under the same
parent. It normalizes separators and decimal zero-padding in provisional
designations, not Roman numerals into NAIF codes. Raw spellings are retained.
Different matching NAIF numbers remain ambiguous. Multiple published source
assignments are classified individually and marked `source-selection-required`;
table order is not a selection policy. Upstream tables and comments can disagree:
cross-check against the [NAIF ID registry](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/naif_ids.html)
before resolving a conflict, and retain both claims.

The descriptor classifier accepts the gap-free union of original segments for a
target, but this does not prove a usable center chain or numerical accuracy.
Runtime whole-window selection likewise keeps a fixed kernel set and retains
original segment precedence. A missing position is not a zero vector: only the
Sun has a heliocentric-origin fallback. Missing reference states suppress the
frame; incomplete trails are omitted rather than connected across gaps.

After a parser correction, reinterpret verified raw evidence offline without
overwriting or silently refetching an older snapshot:

```sh
node scripts/survey-satellite-ephemerides.mjs --rebuild OLD_DIRECTORY --output NEW_DIRECTORY
node scripts/survey-satellite-ephemerides.mjs --verify NEW_DIRECTORY
```

The derived report records the old report's SHA-256. Verification checks current
interpretation as well as archived bytes; an old interpretation can fail after a
parser correction and must be explicitly rebuilt into a new directory.

## Independent join fixture

`tests/fixtures/jup347-himalia-join.bsp` retains original type-2 records on both
sides of JUP347's 2023-12-11 TDB split. Its adjacent descriptors and independent
CSPICE position/velocity references are tested in `kernel-window.test.ts`.
The provenance JSON pins both the crop and the DE440 core used by the numerical
oracle. This is an evaluator/selection regression, not proof of observational
accuracy or a DE442-consistent complete-system solution.

## 中文边界

这只是可重放的身份与数据覆盖调查，不代表新增星体已经上线，也不等于完整物理。
原始目录、网页、星历注释和编号冲突全部保留；不能按网页行序选择解，不能把动力学
模型中的零 GM 当成实测零质量。缺少位置时不绘制天体，参考系无数据时不虚构原点，
轨迹有缺口时不跨越缺口连线。完整数据接入与 Pages 容量选择必须另行明确验证。
