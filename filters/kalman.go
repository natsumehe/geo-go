package filters

// KalmanFilter 结构体，保存每个维度的滤波状态
type KalmanFilter struct {
	LastValue float64 // 上一次的最优估计值（状态）
	P         float64 // 估计协方差（代表对当前状态的信任度）
	Q         float64 // 过程噪声（代表运动的不可预测性，建议取 0.000001）
	R         float64 // 测量噪声（代表传感器误差，由精度因子动态决定）
}

// SmartUpdate 根据观测值和手机精度因子更新状态
func (kf *KalmanFilter) SmartUpdate(measurement float64, accuracy float64) float64 {
	// 动态调整 R：将米制精度映射到经纬度方差
	// 经验公式：精度越差，R 越大，增益 K 越小，越相信历史预测
	kf.R = (accuracy * accuracy) * 0.0000000001

	// 1. 预测阶段 (Prediction)
	kf.P = kf.P + kf.Q

	// 2. 更新阶段 (Update)
	// 计算卡尔曼增益 K (0 ~ 1)
	k := kf.P / (kf.P + kf.R)

	// 结合观测值修正最优估计
	kf.LastValue = kf.LastValue + k*(measurement-kf.LastValue)

	// 更新估计协方差
	kf.P = (1 - k) * kf.P

	return kf.LastValue
}
