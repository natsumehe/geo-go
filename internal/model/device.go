package model

import (
	"time"
	"geo/internal/filter"
)

type DeviceFilters struct {
	LatKF    *filter.KalmanFilter
	LngKF    *filter.KalmanFilter
	LastSeen time.Time
}

type LastPos struct {
	Lat       float64
	Lng       float64
	Timestamp time.Time
}