/* Real-source state reference generator using the independent NAIF library.
 * Arguments: TARGET FIRST_ET LAST_ET NEW_JSON SOURCE_SPK CORE_SPK.
 * Dates are numerical TDB seconds, not UTC. Samples include selected original
 * record boundaries and both heliocentric J2000 and barycentric ECLIPJ2000.
 */
#include "SpiceUsr.h"
#include <stdio.h>
#include <stdlib.h>

static void check(void) {
  if (failed_c()) { char message[1841]; getmsg_c("LONG",1841,message); fprintf(stderr,"%s\n",message); exit(1); }
}
int main(int argc, char **argv) {
  if (argc != 7) return 2;
  int target = atoi(argv[1]); double first = atof(argv[2]), last = atof(argv[3]);
  erract_c("SET",0,"RETURN");
  furnsh_c(argv[6]); furnsh_c(argv[5]); check();
  double times[2048]; int count = 0;
  for (int i = 0; i <= 60; i++) times[count++] = first+(last-first)*i/60.;
  SpiceInt handle; SpiceBoolean found;
  dafopr_c(argv[5],&handle); dafbfs_c(handle); daffna_c(&found); check();
  while (found) {
    SpiceDouble summary[5], dc[2], tail[2]; SpiceInt ic[6];
    dafgs_c(summary); dafus_c(summary,2,6,dc,ic); check();
    if (ic[0] == target && ic[3] == 21) {
      dafgda_c(handle,ic[5]-1,ic[5],tail); check();
      int n = (int)tail[1], size = 4*(int)tail[0]+11;
      int indices[] = {0, n/2, n-1, 98, 99, 100, 198, 199, 200};
      for (int k = 0; k < 9; k++) if (indices[k] < n) {
        double epoch; int address = ic[4]+n*size+indices[k];
        dafgda_c(handle,address,address,&epoch); check();
        for (int side = -1; side <= 1; side++) {
          double et = epoch+side*0.0001;
          if (et >= first && et <= last) { if(count>=2048) return 3; times[count++]=et; }
        }
      }
    }
    daffna_c(&found); check();
  }
  dafcls_c(handle);
  FILE *out = fopen(argv[4],"wx"); if(!out) return 4;
  fprintf(out,"{\"oracle\":\"NAIF CSPICE N0067 spkgeo\",\"target\":%d,\"firstEt\":%.17g,\"lastEt\":%.17g,\"samples\":[\n",target,first,last);
  for(int i=0;i<count;i++) {
    double helio[6], bary[6], lt;
    spkgeo_c(target,times[i],"J2000",10,helio,&lt); check();
    spkgeo_c(target,times[i],"ECLIPJ2000",0,bary,&lt); check();
    fprintf(out,"%s{\"et\":%.17g,\"heliocentricJ2000\":[",i ? ",\n" : "",times[i]);
    for(int j=0;j<6;j++) fprintf(out,"%s%.17g",j ? "," : "",helio[j]);
    fprintf(out,"],\"barycentricEcliptic\":[");
    for(int j=0;j<6;j++) fprintf(out,"%s%.17g",j ? "," : "",bary[j]);
    fprintf(out,"]}");
  }
  fprintf(out,"\n]}\n"); fclose(out); kclear_c(); return 0;
}
