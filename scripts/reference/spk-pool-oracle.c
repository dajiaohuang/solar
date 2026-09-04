/* Independent original-SPK pool oracle, built only against CSPICE.
 * argv[1]: directory of immutable kernels. Input: target ET count filenames.
 * Names have no whitespace. Each row loads the exact ordered pool afresh.
 * Output: heliocentric and barycentric ECLIPJ2000 geometric six-vectors. */
#include "SpiceUsr.h"
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  erract_c("SET", 0, "RETURN");
  int target, count; double et;
  while (scanf("%d %lf %d", &target, &et, &count) == 3) {
    if (count < 1 || count > 32) return 3;
    kclear_c();
    for (int i = 0; i < count; i++) {
      char name[1024], path[4096];
      if (scanf("%1023s", name) != 1) return 4;
      if (snprintf(path, sizeof(path), "%s/%s", argv[1], name) >= (int)sizeof(path)) return 5;
      furnsh_c(path);
      if (failed_c()) return 6;
    }
    double helio[6], bary[6], lt;
    spkgeo_c(target, et, "ECLIPJ2000", 10, helio, &lt);
    spkgeo_c(target, et, "ECLIPJ2000", 0, bary, &lt);
    if (failed_c()) return 7;
    printf("{\"heliocentric\":[");
    for (int i = 0; i < 6; i++) printf("%s%.17g", i ? "," : "", helio[i]);
    printf("],\"barycentric\":[");
    for (int i = 0; i < 6; i++) printf("%s%.17g", i ? "," : "", bary[i]);
    printf("]}\n");
  }
  kclear_c();
  return 0;
}
