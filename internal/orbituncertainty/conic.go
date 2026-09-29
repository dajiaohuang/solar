package orbituncertainty

import (
	"context"
	"errors"
	"math"
)

const floatEpsilon = 0x1p-52

type conicPlane struct {
	x, y, vx, vy float64
	derivatives  [3][4]float64 // e, q, tp; each x, y, vx, vy
}

func ellipticRoot(ctx context.Context, mean, e float64) (float64, error) {
	wrapped := math.Mod(mean, 2*math.Pi)
	if wrapped > math.Pi {
		wrapped -= 2 * math.Pi
	}
	if wrapped < -math.Pi {
		wrapped += 2 * math.Pi
	}
	target := math.Abs(wrapped)
	if target == 0 {
		return 0, nil
	}
	low, high, u := 0.0, math.Pi, target
	if e >= .8 {
		u = math.Min(math.Pi, math.Cbrt(6*target/e))
	}
	for step := 0; step < 80; step++ {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		squared := u * u
		difference := u - math.Sin(u)
		if u < .1 {
			difference = u * squared * (1.0/6 - squared*(1.0/120-squared*(1.0/5040-squared*(1.0/362880-squared/39916800))))
		}
		residual := (1-e)*u + e*difference - target
		sineHalf := math.Sin(u / 2)
		correction := residual / ((1 - e) + 2*e*sineHalf*sineHalf)
		if math.Abs(correction) <= 4*floatEpsilon*math.Abs(u) {
			return math.Copysign(u, wrapped), nil
		}
		if residual > 0 {
			high = u
		} else {
			low = u
		}
		next := u - correction
		if !finite(next) || next <= low || next >= high {
			next = (low + high) / 2
		}
		if next == u {
			return math.Copysign(next, wrapped), nil
		}
		u = next
	}
	return 0, errors.New("elliptic covariance root did not converge")
}

func ellipticPlane(ctx context.Context, e, q, elapsed, mu float64) (conicPlane, error) {
	a := q / (1 - e)
	motion := math.Sqrt(mu / (a * a * a))
	mean := motion * elapsed
	if !finite(a) || !finite(motion) || motion <= 0 || !finite(mean) || math.Abs(mean) > 1e6 {
		return conicPlane{}, errors.New("elliptic covariance scale or phase exceeds numerical domain")
	}
	u, err := ellipticRoot(ctx, mean, e)
	if err != nil {
		return conicPlane{}, err
	}
	sinE, cosE := math.Sincos(u)
	sinHalf := math.Sin(u / 2)
	beta := math.Sqrt((1 - e) * (1 + e))
	d := (1 - e) + 2*e*sinHalf*sinHalf
	speed := motion * a / d
	p := conicPlane{x: a * ((1 - e) - 2*sinHalf*sinHalf), y: a * beta * sinE, vx: -speed * sinE, vy: speed * beta * cosE}
	for axis := 0; axis < 3; axis++ {
		de, da := 0.0, 0.0
		if axis == 0 {
			de, da = 1, a/(1-e)
		}
		if axis == 1 {
			da = 1 / (1 - e)
		}
		dn := -1.5 * motion * da / a
		dMean := dn * elapsed // Keep unwrapped revolution sensitivity.
		if axis == 2 {
			dMean -= motion
		}
		dE, dBeta := (dMean+sinE*de)/d, -e*de/beta
		dx := da*((1-e)-2*sinHalf*sinHalf) - a*(sinE*dE+de)
		dy := da*beta*sinE + a*dBeta*sinE + a*beta*cosE*dE
		dd := -cosE*de + e*sinE*dE
		dSpeed := (dn*a+motion*da)/d - speed*dd/d
		p.derivatives[axis] = [4]float64{dx, dy, -dSpeed*sinE - speed*cosE*dE, dSpeed*beta*cosE + speed*dBeta*cosE - speed*beta*sinE*dE}
	}
	return validPlane(p)
}

type stumpff struct{ c, s, t, dc, ds, dt float64 }

func stumpffFunctions(z float64) stumpff {
	if math.Abs(z) < .1 {
		c, s, dc, ds := .5, 1.0/6, 0.0, 0.0
		cp, sp, power, previous := .5, 1.0/6, 1.0, 1.0
		for k := 1; k <= 16; k++ {
			cp /= -float64((2*k + 1) * (2*k + 2))
			sp /= -float64((2*k + 2) * (2*k + 3))
			power *= z
			c += cp * power
			s += sp * power
			dc += float64(k) * cp * previous
			ds += float64(k) * sp * previous
			previous = power
		}
		return stumpff{c, s, 1 - z*s, dc, ds, -s - z*ds}
	}
	u := math.Sqrt(math.Abs(z))
	sine, half := math.Sin(u), math.Sin(u/2)
	if z < 0 {
		sine, half = math.Sinh(u), math.Sinh(u/2)
	}
	c, s, t := 2*(half/u)*(half/u), (u-sine)/(u*u*u), sine/u
	if z < 0 {
		s = -s
	}
	return stumpff{c, s, t, (t - 2*c) / (2 * z), (c - 3*s) / (2 * z), (s - c) / 2}
}

func universalPlane(ctx context.Context, e, q, elapsed, mu float64) (conicPlane, error) {
	speed := math.Sqrt(mu / q)
	timeScale := q / speed
	tau, beta := elapsed/timeScale, 1-e
	if !finite(speed) || speed <= 0 || !finite(timeScale) || timeScale <= 0 || !finite(tau) || math.Abs(tau) > 1e6 {
		return conicPlane{}, errors.New("conic dimensionless elapsed time exceeds numerical domain")
	}
	evaluate := func(u float64) (stumpff, float64, float64) {
		f := stumpffFunctions(beta * u * u)
		return f, u + e*u*u*u*f.s, 1 + e*u*u*f.c
	}
	target := math.Abs(tau)
	low, high, converged := 0.0, math.Min(1, target), target == 0
	if e >= 2 && target > 0 {
		// For a hyperbola, x=sqrt(e-1)*u turns the Kepler equation into
		// sinh(x)-x/e = target*(e-1)^(3/2)/e. This upper estimate keeps the
		// bracket near the root even for very large finite eccentricities, where
		// starting at u=1 can require far more than 128 bisections.
		rootScale := math.Sqrt(e - 1)
		scaledTarget := target * rootScale * ((e - 1) / e)
		if scaledTarget > 0 && finite(scaledTarget) {
			high = math.Asinh(2*scaledTarget) / rootScale
			if !finite(high) || high <= 0 {
				high = target
			}
		}
	}
	for step := 0; step < 128; step++ {
		if err := ctx.Err(); err != nil {
			return conicPlane{}, err
		}
		_, value, _ := evaluate(high)
		if !(value < target) {
			break
		}
		high *= 2
	}
	_, value, _ := evaluate(high)
	if value < target {
		return conicPlane{}, errors.New("conic covariance root could not be bracketed")
	}
	u := high
	for step := 0; step < 128 && !converged; step++ {
		if err := ctx.Err(); err != nil {
			return conicPlane{}, err
		}
		_, value, radius := evaluate(u)
		residual := value - target
		correction := residual / radius
		if finite(correction) && math.Abs(correction) <= 8*floatEpsilon*math.Abs(u) {
			converged = true
			break
		}
		if residual > 0 || !finite(value) {
			high = u
		} else {
			low = u
		}
		next := u - correction
		if !finite(next) || next <= low || next >= high {
			next = (low + high) / 2
		}
		if next == u {
			converged = true
			break
		}
		u = next
	}
	if !converged {
		return conicPlane{}, errors.New("conic covariance root did not converge")
	}
	if tau < 0 {
		u = -u
	}
	f, _, radius := evaluate(u)
	if !finite(radius) || radius <= 0 {
		return conicPlane{}, errors.New("invalid conic radius")
	}
	transverse := math.Sqrt(1 + e)
	w, h := u*u*f.c, u*f.t
	numerator := 1 - beta*w
	p := conicPlane{x: q * (1 - w), y: q * transverse * h, vx: -speed * h / radius, vy: speed * transverse * numerator / radius}
	for axis := 0; axis < 3; axis++ {
		de, dq, dTau := 0.0, 0.0, 0.0
		if axis == 0 {
			de = 1
		}
		if axis == 1 {
			dq, dTau = 1, -1.5*tau/q
		}
		if axis == 2 {
			dTau = -1 / timeScale
		}
		dBeta := -de
		du := (dTau - de*(u*u*u*f.s-e*u*u*u*u*u*f.ds)) / radius
		dz := dBeta*u*u + 2*beta*u*du
		dw, dh := 2*u*f.c*du+u*u*f.dc*dz, f.t*du+u*f.dt*dz
		dr, dTransverse, dSpeed := de*w+e*dw, de/(2*transverse), -.5*speed*dq/q
		dNumerator := -dBeta*w - beta*dw
		p.derivatives[axis] = [4]float64{
			dq*(1-w) - q*dw, dq*transverse*h + q*dTransverse*h + q*transverse*dh,
			-(dSpeed*h+speed*dh)/radius + speed*h*dr/(radius*radius),
			(dSpeed*transverse*numerator+speed*dTransverse*numerator+speed*transverse*dNumerator)/radius - speed*transverse*numerator*dr/(radius*radius),
		}
	}
	return validPlane(p)
}

func validPlane(p conicPlane) (conicPlane, error) {
	for _, value := range []float64{p.x, p.y, p.vx, p.vy} {
		if !finite(value) {
			return conicPlane{}, errors.New("nonfinite conic state")
		}
	}
	for _, column := range p.derivatives {
		for _, value := range column {
			if !finite(value) {
				return conicPlane{}, errors.New("nonfinite conic derivative")
			}
		}
	}
	return p, nil
}
