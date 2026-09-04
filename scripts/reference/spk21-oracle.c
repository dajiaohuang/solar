/* Independent test-artifact generator. Link official NAIF CSPICE N0067,
 * not the application evaluator. Synthetic records are numerical test data,
 * not trajectories of real celestial bodies. See docs/spk21-validation.md.
 */
#include "SpiceUsr.h"
#include "SpiceZfc.h"
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "Usage: spk21-oracle NEW.bsp NEW.json\n"); return 2; }
  FILE *out = fopen(argv[2], "wx");
  if (!out) { perror("new reference JSON"); return 2; }
  SpiceInt handle;
  const int counts[] = {1, 99, 100, 101, 200, 201};
  const int dimensions[] = {15, 20, 25, 15, 20, 25};
  spkopn_c(argv[1], "Synthetic type21 numerical contract", 0, &handle);
  for (int scenario = 0; scenario < 6; scenario++) {
    integer n = counts[scenario], dim = dimensions[scenario], size = 4*dim+11;
    integer target = -210001-scenario, center = 0;
    double first = 0, last = n*1000.;
    double *lines = calloc(n*size, sizeof(double)), *epochs = calloc(n, sizeof(double));
    if (!lines || !epochs) return 3;
    for (int i = 0; i < n; i++) {
      double *line = lines+i*size;
      line[0] = i*1000.+400.;
      for (int j = 0; j < dim-1; j++) line[1+j] = -450.*(j+1);
      for (int axis = 0; axis < 3; axis++) {
        line[dim+1+2*axis] = (axis+1)*1e8+i*123.45;
        line[dim+2+2*axis] = (axis+1)*0.125+i*0.0003;
        for (int j = 0; j < dim; j++) line[dim+7+axis*dim+j] = (axis+1)*1e-6*pow(0.015,j)*(j%2 ? -1 : 1);
        line[4*dim+8+axis] = dim-axis;
      }
      line[4*dim+7] = dim+1;
      epochs[i] = (i+1)*1000.;
    }
    char frame[] = "J2000", id[] = "Synthetic extended difference test";
    spkw21_(&handle, &target, &center, frame, &first, &last, id, &n, &size, lines, epochs, 5, 34);
    free(lines); free(epochs);
  }
  spkcls_c(handle);
  furnsh_c(argv[1]);
  fprintf(out,"{\n\"oracle\":\"NAIF CSPICE N0067 spkw21/spkez\",\"synthetic\":true,\"frame\":\"J2000\",\"center\":0,\"timeScale\":\"TDB seconds past J2000\",\"samples\":[\n");
  int comma = 0;
  for (int scenario = 0; scenario < 6; scenario++) {
    int target = -210001-scenario;
    double last = counts[scenario]*1000., times[64]; int used = 0;
    times[used++] = 0; times[used++] = last; times[used++] = 37.25;
    const int edges[] = {1, 99, 100, 101, 199, 200};
    for (int k = 0; k < 6; k++) for (int side = -1; side <= 1; side++) {
      double et = edges[k]*1000.+side*1e-6;
      if (et >= 0 && et <= last) times[used++] = et;
    }
    for (int i = 0; i < 16; i++) times[used++] = last*((i*37+13)%997)/997.;
    for (int i = 0; i < used; i++) {
      double state[6], lightTime;
      spkez_c(target, times[i], "J2000", "NONE", 0, state, &lightTime);
      fprintf(out,"%s{\"target\":%d,\"et\":%.17g,\"state\":[",comma++ ? ",\n" : "",target,times[i]);
      for (int axis = 0; axis < 6; axis++) fprintf(out,"%s%.17g",axis ? "," : "",state[axis]);
      fprintf(out,"]}");
    }
  }
  fprintf(out,"\n]}\n"); fclose(out); kclear_c(); return 0;
}
