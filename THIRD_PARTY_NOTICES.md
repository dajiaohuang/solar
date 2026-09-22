# Third-party scientific software

The ground-observer and Earth-orientation implementation uses
[GoFA v1.19.1](https://github.com/hebl/gofa/tree/v1.19.1), a Go port of routines
from the International Astronomical Union's Standards Of Fundamental Astronomy
(SOFA), based on the 2023-10-11 SOFA release. GoFA is copyright HE Boliang and
distributed under its MIT license and the accompanying SOFA terms.

Solar Atlas uses routines and computations derived through GoFA from software
provided by SOFA under license. Solar Atlas does not itself constitute software
provided by or endorsed by SOFA. Our code adds IERS file validation, source
identity, bounded interpolation, SPK integration and product APIs around the
unmodified GoFA dependency. It does not rename its routines to imply official
SOFA implementation status.

The dependency's license notices are retained in [third-party/gofa-LICENSE.txt](third-party/gofa-LICENSE.txt)
and [third-party/SOFA-LICENSE.txt](third-party/SOFA-LICENSE.txt).
