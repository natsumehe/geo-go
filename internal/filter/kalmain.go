package filter

import "math"

type KalmanFilter struct {
	LastValue float64
	P         float64
	Q         float64
	R         float64
}

func (kf *KalmanFilter) SmartUpdate(measuredValue float64, maxDelta float64) float64 {
	if math.Abs(measuredValue-kf.LastValue) > maxDelta {
		return kf.LastValue
	}
	kf.P = kf.P + kf.Q
	kGain := kf.P / (kf.P + kf.R)
	kf.LastValue = kf.LastValue + kGain*(measuredValue-kf.LastValue)
	kf.P = (1 - kGain) * kf.P
	return kf.LastValue
}