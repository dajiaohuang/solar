package observation

import (
	"fmt"
	"math"

	"github.com/hebl/gofa"
)

type StellarDirection struct {
	Model                  string     `json:"model"`
	ProperDirectionGCRS    [3]float64 `json:"properDirectionGcrs"`
	CIRSRADeg              float64    `json:"cirsRaDeg"`
	CIRSDecDeg             float64    `json:"cirsDecDeg"`
	ApparentAirless        Direction  `json:"apparentAirless"`
	Refracted              *Direction `json:"refracted,omitempty"`
	RefractionStatus       string     `json:"refractionStatus"`
	SolarElongationDeg     float64    `json:"solarElongationDeg"`
	SolarDeflectionLimited bool       `json:"solarDeflectionLimited"`
	Warnings               []string   `json:"warnings"`
	Limitations            []string   `json:"limitations"`
}

// ObserveStellarCoordinate consumes a direction whose proper motion/parallax
// already refer to this observer and epoch. It must not call Atciq/Pmpx again.
// The retained Apco context includes the station's diurnal velocity, with
// Diurab=0 for Atioq, avoiding a second application of diurnal aberration.
func (r *Result) ObserveStellarCoordinate(coordinate [3]float64) (*StellarDirection, error) {
	if r == nil || r.astrometry == nil {
		return nil, fmt.Errorf("stellar transform requires a live source-backed observation context")
	}
	for _, value := range coordinate {
		if !finite(value) {
			return nil, fmt.Errorf("non-finite stellar coordinate direction")
		}
	}
	if math.Abs(math.Hypot(math.Hypot(coordinate[0], coordinate[1]), coordinate[2])-1) > 1e-12 {
		return nil, fmt.Errorf("stellar coordinate direction must be a unit vector")
	}
	astrom := *r.astrometry
	var natural, proper, cirs [3]float64
	gofa.Ldsun(coordinate, astrom.Eh, astrom.Em, &natural)
	gofa.Ab(natural, astrom.V, astrom.Em, astrom.Bm1, &proper)
	gofa.Rxp(astrom.Bpn, proper, &cirs)
	var ra, dec float64
	gofa.C2s(cirs, &ra, &dec)
	airless := direction(proper, astrom)
	for _, value := range append(proper[:], ra, dec, airless.AzimuthDeg, airless.AltitudeDeg) {
		if !finite(value) {
			return nil, fmt.Errorf("non-finite stellar apparent direction")
		}
	}
	var cross [3]float64
	gofa.Pxp(coordinate, astrom.Eh, &cross)
	cosine := gofa.Pdp(coordinate, astrom.Eh)
	elongation := math.Atan2(math.Hypot(math.Hypot(cross[0], cross[1]), cross[2]), -cosine) * gofa.DR2D
	limited := 1+cosine < 1e-6/math.Max(astrom.Em*astrom.Em, 1)
	warnings := []string{}
	if limited {
		warnings = append(warnings, "solar-deflection-limited-near-solar-center")
	}
	var refracted *Direction
	refractionStatus := "not-requested"
	if r.refractedAstrometry != nil {
		if airless.AltitudeDeg < 5 {
			refractionStatus = "outside-altitude-domain"
			warnings = append(warnings, "refraction-outside-supported-altitude-at-least-5-deg")
		} else {
			d := direction(proper, *r.refractedAstrometry)
			if !finite(d.AzimuthDeg) || !finite(d.AltitudeDeg) {
				return nil, fmt.Errorf("non-finite stellar refracted direction")
			}
			refracted = &d
			refractionStatus = "applied"
		}
	}
	return &StellarDirection{Model: "sofa-ldsun-ab-cirs-atioq-v1", ProperDirectionGCRS: proper,
		CIRSRADeg: gofa.Anp(ra) * gofa.DR2D, CIRSDecDeg: dec * gofa.DR2D, ApparentAirless: airless,
		Refracted: refracted, RefractionStatus: refractionStatus,
		SolarElongationDeg: elongation, SolarDeflectionLimited: limited, Warnings: warnings,
		Limitations: []string{
			"Solar elongation is the coordinate angle to the reception Sun before deflection and aberration, not the separation of two apparent sky positions.",
			"Distant-source solar-monopole deflection at the reception observer context; no planetary deflection or full relativistic light path.",
			"Aberration includes the source Earth and station velocity from the same Apco context. No second observer-parallax or proper-motion correction is applied here.",
			"CIRS and north-zero/east-positive airless horizontal coordinates use the same IAU 2006/2000A and IERS context. Airless output never includes atmospheric refraction.",
			"Optional refraction uses explicit pressure, temperature, humidity and wavelength with SOFA Refco/Atioq, only at airless altitude at least 5 degrees. This software boundary is not a physical accuracy certificate; local atmospheric profiles are not modeled.",
			"Altitude and solar elongation are not a visibility determination: terrain, solar/planetary disks, daylight, stellar diameter and uncertainty are not evaluated.",
		}}, nil
}
