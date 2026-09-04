/* Independent CSPICE oracle. Input lines: ET followed by the original 12-word
 * Type 17 record. Output: JSON six-component states in km and km/s.
 * cc -I<CSPICE>/include spk17-oracle.c <CSPICE>/lib/cspice.a -lm -o spk17-oracle
 * No Solar Atlas evaluator is linked into this executable. */
#include <stdio.h>
#include "SpiceUsr.h"

int main(void) {
  double et, record[12], state[6];
  while (scanf("%lf", &et) == 1) {
    for (int i = 0; i < 12; ++i) if (scanf("%lf", &record[i]) != 1) return 2;
    eqncpv_c(et, record[0], record + 1, record[10], record[11], state);
    if (failed_c()) return 3;
    printf("[%.17g,%.17g,%.17g,%.17g,%.17g,%.17g]\n",
      state[0], state[1], state[2], state[3], state[4], state[5]);
  }
  return 0;
}
